const { Alchemy, Network } = require("alchemy-sdk");
const { Web3 } = require('web3');
require("dotenv").config();

const {
    DynamoDBClient,
    CreateTableCommand,
    waitUntilTableExists
} = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const providerAlchemyWs = `wss://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const providerAlchemyHttp = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

const DYNAMODB_STATUS_TABLE = "PingPongBotStatus";
const DYNAMODB_FAILED_TX_TABLE = "PingPongBotFailedTxs";
const DYNAMODB_PARTITION_KEY = "statusId";
const DYNAMODB_PRIMARY_KEY_VALUE = "main_status";

const awsClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
});
const docClient = DynamoDBDocumentClient.from(awsClient);

let processedTxs = new Set();
let pendingPingHashes = new Set();
let web3 = new Web3(providerAlchemyWs);

const settings = {
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_SEPOLIA,
};
const alchemy = new Alchemy(settings);

const contractABI = [
    { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "pinger", "type": "address" }], "name": "NewPinger", "type": "event" },
    { "anonymous": false, "inputs": [], "name": "Ping", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "bytes32", "name": "txHash", "type": "bytes32" }], "name": "Pong", "type": "event" },
    { "inputs": [{ "internalType": "address", "name": "_pinger", "type": "address" }], "name": "changePinger", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "ping", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "pinger", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "bytes32", "name": "_txHash", "type": "bytes32" }], "name": "pong", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];

const pingEventSig = web3.utils.sha3("Ping()");

let lastProcessedBlock = 0;
const MAX_RETRIES = 5;

const web3Http = new Web3(providerAlchemyHttp);
const cleanPrivateKey = '0x' + PRIVATE_KEY.trim();
const account = web3Http.eth.accounts.privateKeyToAccount(cleanPrivateKey);

let txQueue = [];
let isProcessingQueue = false;

async function ensureTableExists(tableName, keySchema, attributeDefinitions) {
    try {
        await awsClient.send(new CreateTableCommand({
            TableName: tableName,
            KeySchema: keySchema,
            AttributeDefinitions: attributeDefinitions,
            BillingMode: 'PAY_PER_REQUEST'
        }));
        await waitUntilTableExists({ client: awsClient, maxWaitTime: 180 }, { TableName: tableName });
    } catch (error) {
        if (error.name !== 'ResourceInUseException') {
            throw error;
        }
    }
}
async function markPingAsPending(pingTxHash) {
    const params = {
        TableName: DYNAMODB_STATUS_TABLE,
        Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
        UpdateExpression: "ADD pendingPingHashes :hash",
        ExpressionAttributeValues: { ":hash": new Set([pingTxHash]) },
    };
    await docClient.send(new UpdateCommand(params));
}
async function markPingAsSuccess(pingTxHash, receipt) {
    const params = {
        TableName: DYNAMODB_STATUS_TABLE,
        Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
        UpdateExpression: "SET lastProcessedBlock = :block, lastProcessedTxHash = :hashString " +
                          "ADD processedTxs :hashSet " +
                          "DELETE pendingPingHashes :hashSet",
        ExpressionAttributeValues: {
            ":block": Number(receipt.blockNumber),
            ":hashString": pingTxHash,
            ":hashSet": new Set([pingTxHash]),
        },
    };
    await docClient.send(new UpdateCommand(params));
}
async function markPingAsFailed(pingTxHash) {
    const params = {
        TableName: DYNAMODB_STATUS_TABLE,
        Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
        UpdateExpression: "DELETE pendingPingHashes :hash",
        ExpressionAttributeValues: { ":hash": new Set([pingTxHash]) },
    };
    await docClient.send(new UpdateCommand(params));
}
async function updateLastProcessedBlockInDb(blockNumber) {
    const params = {
        TableName: DYNAMODB_STATUS_TABLE,
        Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
        UpdateExpression: "SET lastProcessedBlock = :block",
        ExpressionAttributeValues: { ":block": blockNumber },
    };
    await docClient.send(new UpdateCommand(params));
}
async function recordFailedTransaction(txHash, reason) {
    const params = {
        TableName: DYNAMODB_FAILED_TX_TABLE,
        Item: {
            pingTxHash: txHash,
            failureReason: reason,
            timestamp: new Date().toISOString(),
        },
    };
    await docClient.send(new PutCommand(params));
}

async function handlePingEvent({ transactionHash }) {
    if (!transactionHash || processedTxs.has(transactionHash) || pendingPingHashes.has(transactionHash)) {
        return;
    }

    if (!txQueue.includes(transactionHash)) {
        txQueue.push(transactionHash);
    }
    
    processTxQueue();
}

async function processTxQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    const contract = new web3Http.eth.Contract(contractABI, CONTRACT_ADDRESS);

    while (txQueue.length > 0) {
        const pingTxHash = txQueue.shift();
        if (processedTxs.has(pingTxHash)) { continue; }

        pendingPingHashes.add(pingTxHash);
        await markPingAsPending(pingTxHash);

        let success = false;
        let finalError = "Max retries reached.";

        for (let retries = 0; retries < MAX_RETRIES; retries++) {
            try {
                let nonce = await web3Http.eth.getTransactionCount(account.address, "pending");
                
                const tx = contract.methods.pong(pingTxHash);
                const gas = await tx.estimateGas({ from: account.address });
                const data = tx.encodeABI();
                
                const pendingBlock = await web3Http.eth.getBlock("pending");
                const priorityFee = BigInt(1.5 * 1e9) + (BigInt(retries) * BigInt(1 * 1e9));
                const baseFee = pendingBlock.baseFeePerGas ? BigInt(pendingBlock.baseFeePerGas) : BigInt(20 * 1e9);
                const maxFee = baseFee + priorityFee;

                const txParams = { to: CONTRACT_ADDRESS, data, gas, nonce, chainId: 11155111, maxFeePerGas: maxFee, maxPriorityFeePerGas: priorityFee };

                const signedTx = await web3Http.eth.accounts.signTransaction(txParams, cleanPrivateKey);
                const receipt = await web3Http.eth.sendSignedTransaction(signedTx.rawTransaction);

                processedTxs.add(pingTxHash);
                pendingPingHashes.delete(pingTxHash);
                lastProcessedBlock = Number(receipt.blockNumber);
                await markPingAsSuccess(pingTxHash, receipt);
                
                success = true;
                break;
            } catch (error) {
                const errMsg = error.message || error.toString();
                finalError = errMsg;
                if (retries < MAX_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, 2000 * (retries + 1)));
                }
            }
        }

        if (!success) {
            await recordFailedTransaction(pingTxHash, finalError);
            pendingPingHashes.delete(pingTxHash);
            await markPingAsFailed(pingTxHash);
        }
    }

    isProcessingQueue = false;
}

async function catchUpMissedEvents(startFromBlock) {
    const contract = new web3Http.eth.Contract(contractABI, CONTRACT_ADDRESS);
    const latestBlock = Number(await web3Http.eth.getBlockNumber());

    if (startFromBlock >= latestBlock) {
      return;
    }
    const CHUNK_SIZE = 499;
    for (let fromBlock = startFromBlock + 1; fromBlock <= latestBlock; fromBlock += CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlock);
      try {
        const events = await contract.getPastEvents("Ping", { fromBlock, toBlock });
        for (const event of events) {
            if (!txQueue.includes(event.transactionHash)) {
                txQueue.push(event.transactionHash);
            }
        }
        await updateLastProcessedBlockInDb(toBlock);
      } catch (error) {
        break;
      }
    }
}

(async () => {
  if (!PRIVATE_KEY || !CONTRACT_ADDRESS || !ALCHEMY_API_KEY) {
    process.exit(1);
  }

  try {
    await ensureTableExists(DYNAMODB_STATUS_TABLE,
        [{ AttributeName: DYNAMODB_PARTITION_KEY, KeyType: 'HASH' }],
        [{ AttributeName: DYNAMODB_PARTITION_KEY, AttributeType: 'S' }]
    );
    await ensureTableExists(DYNAMODB_FAILED_TX_TABLE,
        [{ AttributeName: 'pingTxHash', KeyType: 'HASH' }],
        [{ AttributeName: 'pingTxHash', AttributeType: 'S' }]
    );

    const getParams = { TableName: DYNAMODB_STATUS_TABLE, Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE } };
    const { Item } = await docClient.send(new GetCommand(getParams));

    if (Item) {
        lastProcessedBlock = Number(Item.lastProcessedBlock || 0);
        processedTxs = new Set(Item.processedTxs || []);
        pendingPingHashes = new Set(Item.pendingPingHashes || []);
    } else {
        lastProcessedBlock = Number(await web3Http.eth.getBlockNumber());
        const initialItem = { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE, lastProcessedBlock };
        await docClient.send(new PutCommand({ TableName: DYNAMODB_STATUS_TABLE, Item: initialItem }));
    }

    if (pendingPingHashes.size > 0) {
        for (const hash of pendingPingHashes) {
            if (!txQueue.includes(hash)) {
                txQueue.push(hash);
            }
        }
    }

    await catchUpMissedEvents(lastProcessedBlock);

    if (txQueue.length > 0) {
        processTxQueue();
    }
    
    alchemy.ws.on({ address: CONTRACT_ADDRESS, topics: [pingEventSig] }, (log) => {
      handlePingEvent({ transactionHash: log.transactionHash });
    });

  } catch (err) {
    process.exit(1);
  }
})();