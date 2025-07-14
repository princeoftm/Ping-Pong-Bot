const { initializeStateFromDb, handlePingEvent } = require('./handlers/pingHandler');
const { alchemy } = require('./web3');
const { CONTRACT_ADDRESS } = require('./config');
const { web3Ws } = require('./web3');

(async () => {
  await initializeStateFromDb();

  const pingEventSig = web3Ws.utils.sha3("Ping()");
  alchemy.ws.on(
    { address: CONTRACT_ADDRESS, topics: [pingEventSig] },
    (log) => handlePingEvent({ transactionHash: log.transactionHash })
  );
})();
