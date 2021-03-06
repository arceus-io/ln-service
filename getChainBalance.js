const {promisify} = require('util');

const {getChainBalance} = require('./lightning');

/** Get balance

  {
    lnd: <LND GRPC API Object>
  }

  @returns via Promise
  {
    chain_balance: <Chain Balance Tokens>
  }
*/
module.exports = promisify(getChainBalance);

