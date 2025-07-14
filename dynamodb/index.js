const {
  DynamoDBClient,
  CreateTableCommand,
  waitUntilTableExists
} = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand
} = require("@aws-sdk/lib-dynamodb");
const {
  AWS_REGION,
  DYNAMODB_STATUS_TABLE,
  DYNAMODB_FAILED_TX_TABLE,
  DYNAMODB_PARTITION_KEY,
  DYNAMODB_PRIMARY_KEY_VALUE
} = require('../config');

const awsClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(awsClient);

// Export reusable functions: ensureTableExists, markPingAsPending, etc.

module.exports = {
  docClient,
  awsClient,
  CreateTableCommand,
  waitUntilTableExists,
  GetCommand,
  UpdateCommand,
  PutCommand,
  constants: {
    DYNAMODB_STATUS_TABLE,
    DYNAMODB_FAILED_TX_TABLE,
    DYNAMODB_PARTITION_KEY,
    DYNAMODB_PRIMARY_KEY_VALUE
  }
};
