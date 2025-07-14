require('dotenv').config();

module.exports = {
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  DYNAMODB_STATUS_TABLE: "PingPongBotStatus",
  DYNAMODB_FAILED_TX_TABLE: "PingPongBotFailedTxs",
  DYNAMODB_PARTITION_KEY: "statusId",
  DYNAMODB_PRIMARY_KEY_VALUE: "main_status",
};
