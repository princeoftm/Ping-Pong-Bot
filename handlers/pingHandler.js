const {
  docClient,
  UpdateCommand,
  PutCommand,
  GetCommand,
  constants: {
    DYNAMODB_STATUS_TABLE,
    DYNAMODB_FAILED_TX_TABLE,
    DYNAMODB_PARTITION_KEY,
    DYNAMODB_PRIMARY_KEY_VALUE,
  },
} = require('../dynamodb');

const { web3Http, contract, account } = require('../web3');

const MAX_RETRIES = 5;
let processedTxs = new Set();
let pendingPingHashes = new Set();
let txQueue = [];
let isProcessingQueue = false;
let lastProcessedBlock = 0;

async function markPingAsPending(pingTxHash) {
  const params = {
    TableName: DYNAMODB_STATUS_TABLE,
    Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
    UpdateExpression: "ADD pendingPingHashes :hash",
    ExpressionAttributeValues: {
      ":hash": docClient.createSet([pingTxHash])
    },
  };
  await docClient.send(new UpdateCommand(params));
}

async function markPingAsSuccess(pingTxHash, receipt) {
  const params = {
    TableName: DYNAMODB_STATUS_TABLE,
    Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
    UpdateExpression:
      "SET lastProcessedBlock = :block, lastProcessedTxHash = :hashString " +
      "ADD processedTxs :hashSet " +
      "DELETE pendingPingHashes :hashSet",
    ExpressionAttributeValues: {
      ":block": Number(receipt.blockNumber),
      ":hashString": pingTxHash,
      ":hashSet": docClient.createSet([pingTxHash]),
    },
  };
  await docClient.send(new UpdateCommand(params));
}

async function markPingAsFailed(pingTxHash) {
  const params = {
    TableName: DYNAMODB_STATUS_TABLE,
    Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
    UpdateExpression: "DELETE pendingPingHashes :hash",
    ExpressionAttributeValues: {
      ":hash": docClient.createSet([pingTxHash]),
    },
  };
  await docClient.send(new UpdateCommand(params));
}

async function updateLastProcessedBlockInDb(blockNumber) {
  const params = {
    TableName: DYNAMODB_STATUS_TABLE,
    Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
    UpdateExpression: "SET lastProcessedBlock = :block",
    ExpressionAttributeValues: {
      ":block": blockNumber,
    },
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

  await processTxQueue();
}

async function processTxQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (txQueue.length > 0) {
    const pingTxHash = txQueue.shift();
    if (processedTxs.has(pingTxHash)) continue;

    pendingPingHashes.add(pingTxHash);
    await markPingAsPending(pingTxHash);

    let success = false;
    let finalError = "Max retries reached.";

    for (let retries = 0; retries < MAX_RETRIES; retries++) {
      try {
        const nonce = await web3Http.eth.getTransactionCount(account.address, "pending");

        const tx = contract.methods.pong(pingTxHash);
        const gas = await tx.estimateGas({ from: account.address });
        const data = tx.encodeABI();

        const pendingBlock = await web3Http.eth.getBlock("pending");
        const priorityFee = BigInt(1.5e9) + (BigInt(retries) * BigInt(1e9));
        const baseFee = pendingBlock.baseFeePerGas ? BigInt(pendingBlock.baseFeePerGas) : BigInt(20e9);
        const maxFee = baseFee + priorityFee;

        const txParams = {
          to: contract.options.address,
          data,
          gas,
          nonce,
          chainId: 11155111, // Sepolia
          maxFeePerGas: maxFee.toString(),
          maxPriorityFeePerGas: priorityFee.toString(),
        };

        const signedTx = await web3Http.eth.accounts.signTransaction(txParams, account.privateKey);
        const receipt = await web3Http.eth.sendSignedTransaction(signedTx.rawTransaction);

        processedTxs.add(pingTxHash);
        pendingPingHashes.delete(pingTxHash);
        lastProcessedBlock = Number(receipt.blockNumber);

        await markPingAsSuccess(pingTxHash, receipt);

        success = true;
        break;
      } catch (error) {
        finalError = error.message || error.toString();
        if (retries < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (retries + 1)));
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
  const latestBlock = Number(await web3Http.eth.getBlockNumber());
  if (startFromBlock >= latestBlock) return;

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
      console.error(`Failed to fetch events from block ${fromBlock} to ${toBlock}:`, error.message);
      break;
    }
  }
}

async function initializeStateFromDb() {
  const getParams = {
    TableName: DYNAMODB_STATUS_TABLE,
    Key: { [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE },
  };

  const { Item } = await docClient.send(new GetCommand(getParams));

  if (Item) {
    lastProcessedBlock = Number(Item.lastProcessedBlock || 0);
    processedTxs = new Set(Item.processedTxs?.values || []);
    pendingPingHashes = new Set(Item.pendingPingHashes?.values || []);
  } else {
    lastProcessedBlock = Number(await web3Http.eth.getBlockNumber());
    const initialItem = {
      [DYNAMODB_PARTITION_KEY]: DYNAMODB_PRIMARY_KEY_VALUE,
      lastProcessedBlock,
    };
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
    await processTxQueue();
  }
}

module.exports = {
  handlePingEvent,
  initializeStateFromDb
};
