-----

# Ethereum Ping-Pong Bot

This project is a highly resilient Node.js bot designed to interact with an Ethereum smart contract. It listens for a `Ping` event on the blockchain and automatically responds by sending a `pong` transaction in a safe, sequential manner.

The architecture is built for robustness, using AWS DynamoDB for persistent state management to ensure no events are missed, even if the bot is restarted.

-----

## 📋 Table of Contents

  - [Key Features](https://www.google.com/search?q=%23-key-features)
  - [Prerequisites](https://www.google.com/search?q=%23-prerequisites)
  - [Setup & Installation](https://www.google.com/search?q=%23-1-setup--installation)
  - [Running the Bot](https://www.google.com/search?q=%23-2-running-the-bot)
  - [How It Works](https://www.google.com/search?q=%23-3-how-it-works)
      - [State Management (DynamoDB)](https://www.google.com/search?q=%23state-management-dynamodb)
      - [Sequential Processing and Nonce Handling](https://www.google.com/search?q=%23sequential-processing-and-nonce-handling)
      - [Event Processing Flow](https://www.google.com/search?q=%23event-processing-flow)
  - [Dependencies](https://www.google.com/search?q=%23-dependencies)
  - [Contributing](https://www.google.com/search?q=%23-contributing)
  - [License](https://www.google.com/search?q=%23-license)

-----

## ✨ Key Features

  * **💾 Resilient State Management**: Leverages AWS DynamoDB to save its progress (`lastProcessedBlock`, pending transactions, etc.). If the bot crashes, it can restart and resume exactly where it left off.
  * **🔍 Historical Event Catch-up**: On startup, it scans the blockchain for any `Ping` events that were missed while the bot was offline.
  * **⛽ Dynamic Gas Price Bumping**: Implements a gas fee strategy that increases the fee on each retry, helping transactions get confirmed in a congested network environment.
  * **🔁 Retries and Error Logging**: Failed transactions are retried multiple times. If a transaction ultimately fails, it is recorded in a separate DynamoDB table for manual inspection.

## ✅ Prerequisites

Before you begin, ensure you have the following:

  * **Node.js** (v18 or higher)
  * **An Alchemy Account**: To get an API key for connecting to the Ethereum network (Sepolia testnet is used in this example).
  * **An Ethereum Wallet**: You will need the private key of an account funded with Sepolia ETH.
  * **AWS Account**: With credentials configured locally to allow the SDK to create and interact with DynamoDB tables.

## 🚀 1. Setup & Installation

#### 1.1. Clone the Repository

```bash
git clone <your-repository-url>
cd <repository-directory>
```

#### 1.2. Install Dependencies

```bash
npm install
```

#### 1.3. Configure Environment Variables

Create a `.env` file in the root of the project and populate it with your credentials.

```ini
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

## ▶️ 2. Running the Bot

Once the setup is complete, you can start the bot with the following command

```bash
node bot.js
```

The bot will perform the following actions on startup:

1.  Connect to AWS and ensure the required DynamoDB tables exist (`PingPongBotStatus`, `PingPongBotFailedTxs`).
2.  Load its last known state from the `PingPongBotStatus` table.
3.  Add any transactions that were pending when it last shut down to its internal processing queue.
4.  Scan for any historical `Ping` events it might have missed and add them to the queue.
5.  Begin processing the queue and listen for new `Ping` events in real-time.

## ⚙️ 3. How It Works

### State Management (DynamoDB)

The bot relies on two DynamoDB tables:

1.  **`PingPongBotStatus`**: A single-item table that acts as the bot's memory. It stores:
      * `lastProcessedBlock`: The last blockchain block number the bot scanned.
      * `processedTxs`: A set of `ping` transaction hashes that have been successfully processed.
      * `pendingPingHashes`: A set of `ping` transaction hashes that the bot is currently trying to process. This is crucial for recovery after a crash.
2.  **`PingPongBotFailedTxs`**: A table that logs any `ping` transaction that failed all retry attempts, along with the reason for the failure.

### Sequential Processing and Nonce Handling

The bot is designed for safety and simplicity by processing transactions one at a time.

  * When a new `Ping` event is detected, its transaction hash is added to a simple in-memory array, the `txQueue`.
  * A `processTxQueue` function works through this queue in a `while` loop, processing one item at a time.
  * Critically, the bot fetches the account's nonce from the network **just before sending each transaction**. This just-in-time nonce fetching ensures it always uses the correct, current nonce and prevents any possibility of creating competing transactions. If a transaction gets stuck, the bot will retry it until it succeeds or fails, blocking the queue and ensuring nothing gets sent out of order.

### Event Processing Flow

1.  **Listen**: An Alchemy WebSocket connection listens for `Ping` events.
2.  **Filter**: The bot checks if the event's transaction hash has already been processed or is currently pending.
3.  **Queue**: If the event is new, its hash is pushed into the `txQueue` array.
4.  **Execute**: The `processTxQueue` function picks the next item from the queue. It constructs a `pong` transaction, signs it, and sends it. It waits for this transaction to complete before moving to the next item.
5.  **Confirm**: Upon successful confirmation, the bot updates the `PingPongBotStatus` table in DynamoDB, moving the transaction hash from "pending" to "processed" and updating the `lastProcessedBlock`.

## 📦 Dependencies

  * [alchemy-sdk](https://www.npmjs.com/package/alchemy-sdk)
  * [web3](https://www.npmjs.com/package/web3)
  * [dotenv](https://www.npmjs.com/package/dotenv)
  * [@aws-sdk/client-dynamodb](https://www.npmjs.com/package/@aws-sdk/client-dynamodb)
  * [@aws-sdk/lib-dynamodb](https://www.npmjs.com/package/@aws-sdk/lib-dynamodb)

## 🤝 Contributing

Contributions, issues, and feature requests are welcome\!

## 📜 License

This project is [MIT](https://www.google.com/search?q=./LICENSE) licensed.
