# Ethereum Ping-Pong Bot

This project is a highly resilient and concurrent Node.js bot designed to interact with an Ethereum smart contract. It listens for a `Ping` event on the blockchain and automatically responds by sending a `pong` transaction.

The architecture is built for robustness, using AWS DynamoDB for persistent state management and a sophisticated queueing system to handle concurrent transactions and nonce desynchronization, which are common challenges in production blockchain applications.

## Key Features

* **⚡ Concurrent Transaction Processing**: Utilizes `p-queue` to send multiple `pong` transactions concurrently, maximizing throughput.
* **💾 Resilient State Management**: Leverages AWS DynamoDB to save its progress (`lastProcessedBlock`, pending transactions, etc.). If the bot crashes, it can restart and resume exactly where it left off.
* **🔄 Advanced Nonce Management**: Automatically detects and recovers from "nonce too low" errors. It pauses processing, re-synchronizes its nonce with the network, and re-queues all pending transactions, ensuring no transaction is permanently lost due to nonce issues.
* **🔍 Historical Event Catch-up**: On startup, it scans the blockchain for any `Ping` events that were missed while the bot was offline.
* **⛽ Dynamic Gas Price Bumping**: Implements an aggressive gas fee strategy to ensure transactions are confirmed quickly in a congested network environment.
* **Retries and Error Logging**: Failed transactions are retried multiple times. If a transaction ultimately fails, it is recorded in a separate DynamoDB table for manual inspection.

## Prerequisites

Before you begin, ensure you have the following:

* **Node.js** (v18 or higher)
* **An Alchemy Account**: To get an API key for connecting to the Ethereum network (Sepolia testnet is used in this example).
* **An Ethereum Wallet**: You will need the private key of an account funded with Sepolia ETH.
* **AWS Account**: With credentials configured locally to allow the SDK to create and interact with DynamoDB tables.

## 1. Setup & Installation

**1.1. Clone the Repository**
```bash
git clone <your-repository-url>
cd <repository-directory>
```

**1.2. Install Dependencies**
```bash
npm install
```


**1.3. Configure Environment Variables**
Create a `.env` file in the root of the project and populate it with your credentials.

```
# .env.example

# Alchemy API Key
ALCHEMY_API_KEY="YOUR_ALCHEMY_API_KEY"

# Private key of the bot's wallet (without the '0x' prefix)
PRIVATE_KEY="YOUR_WALLET_PRIVATE_KEY"

# Deployed PingPong smart contract address
CONTRACT_ADDRESS="YOUR_DEPLOYED_CONTRACT_ADDRESS"

# AWS Configuration
AWS_REGION="us-east-1" # Or your preferred AWS region
AWS_ACCESS_KEY_ID="YOUR_AWS_ACCESS_KEY"
AWS_SECRET_ACCESS_KEY="YOUR_AWS_SECRET_KEY"
```

## 2. Running the Bot

Once the setup is complete, you can start the bot with the following command:

```bash
node index.js
```

The bot will perform the following actions on startup:
1.  Connect to AWS and ensure the required DynamoDB tables exist (`PingPongBotStatus`, `PingPongBotFailedTxs`).
2.  Load its last known state from the `PingPongBotStatus` table.
3.  Fetch the current nonce for its account to prepare for sending transactions.
4.  Re-queue any transactions that were pending when it last shut down.
5.  Scan for any historical `Ping` events it might have missed.
6.  Begin listening for new `Ping` events in real-time.

## 3. How It Works

### State Management (DynamoDB)
The bot relies on two DynamoDB tables:

1.  `PingPongBotStatus`: A single-item table that acts as the bot's memory. It stores:
    * `lastProcessedBlock`: The last blockchain block number the bot scanned.
    * `processedTxs`: A set of `ping` transaction hashes that have been successfully processed.
    * `pendingPingHashes`: A set of `ping` transaction hashes that the bot is currently trying to process. This is crucial for recovery after a crash.

2.  `PingPongBotFailedTxs`: A table that logs any `ping` transaction that failed all retry attempts, along with the reason for the failure.

### Concurrency and Nonce Handling
The core of the bot is the `p-queue` library.
* When a new `Ping` event is detected, it's not processed immediately. Instead, a job is created and added to a queue.
* The bot maintains a global `currentNonce` counter. When a job is added to the queue, it is assigned the next available nonce.
* The queue processes up to 5 jobs concurrently (configurable).
* If a transaction fails with a nonce error, the `handleNonceResync` function is triggered. This powerful recovery mechanism pauses all new work, fetches the correct nonce from the network, and rebuilds the transaction queue to ensure the bot can recover gracefully.

### Event Processing Flow
1.  **Listen**: An Alchemy WebSocket connection listens for `Ping` events.
2.  **Filter**: The bot checks if the event's transaction hash has already been processed or is currently pending.
3.  **Queue**: If the event is new, the bot increments its internal nonce counter and adds a `processSingleTransaction` job to the queue, passing it the transaction hash and the assigned nonce.
4.  **Execute**: The queue picks up the job. The bot constructs a `pong` transaction, signs it with the private key, and sends it.
5.  **Confirm**: Upon successful confirmation, the bot updates the `PingPongBotStatus` table in DynamoDB, moving the transaction hash from "pending" to "processed" and updating the `lastProcessedBlock`.

## Dependencies

* [alchemy-sdk](https://www.npmjs.com/package/alchemy-sdk)
* [web3](https://www.npmjs.com/package/web3)
* [p-queue](https://www.npmjs.com/package/p-queue)
* [dotenv](https://www.npmjs.com/package/dotenv)
* [@aws-sdk/client-dynamodb](https://www.npmjs.com/package/@aws-sdk/client-dynamodb)
* [@aws-sdk/lib-dynamodb](https://www.npmjs.com/package/@aws-sdk/lib-dynamodb)