const { Web3 } = require('web3');
const { Alchemy, Network } = require('alchemy-sdk');
const { contractABI } = require('../abi');
const { ALCHEMY_API_KEY, PRIVATE_KEY, CONTRACT_ADDRESS } = require('../config');

const providerAlchemyWs = `wss://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const providerAlchemyHttp = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

const web3Ws = new Web3(providerAlchemyWs);
const web3Http = new Web3(providerAlchemyHttp);

const account = web3Http.eth.accounts.privateKeyToAccount('0x' + PRIVATE_KEY.trim());

const contract = new web3Http.eth.Contract(contractABI, CONTRACT_ADDRESS);

const alchemy = new Alchemy({ apiKey: ALCHEMY_API_KEY, network: Network.ETH_SEPOLIA });

module.exports = {
  web3Ws,
  web3Http,
  contract,
  account,
  alchemy
};
