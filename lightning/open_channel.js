const asyncAuto = require('async/auto');

const getChainBalance = require('./get_chain_balance');
const {returnResult} = require('./../async-util');

const channelLimit = require('./conf/lnd').channel_limit_tokens;

const staticFee = 1e3;
const minimumChannelSize = 20000;

/** Open a new channel.

  {
    [chain_fee_tokens_per_vbyte]: <Chain Fee Tokens Per VByte Number>
    [give_tokens]: <Tokens to Give To Partner Number>
    lnd: <LND GRPC API Object>
    [local_tokens]: <Local Tokens Number> // When not set, uses max possible
    partner_public_key: <Public Key Hex String>
  }

  @returns via cbk
  {
    transaction_id: <Funding Transaction Id String>
    transaction_vout: <Funding Transaction Output Index>
    type: <Type> // 'channel_pending'
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.lnd) {
        return cbk([400, 'ExpectedLnd']);
      }

      if (!args.partner_public_key) {
        return cbk([400, 'ExpectedPartnerPublicKey']);
      }

      if (args.local_tokens < minimumChannelSize) {
        return cbk([400, 'ExpectedLargerChannelSize']);
      }

      if (args.local_tokens > channelLimit) {
        return cbk([400, 'ChannelSizeExceedsChannelLimit']);
      }

      return cbk();
    },

    // Get the current chain balance
    getChainBalance: cbk => getChainBalance({lnd: args.lnd}, cbk),

    // Open the channel
    openChannel: ['getChainBalance', 'validate', ({getChainBalance}, cbk) => {
      const balance = getChainBalance.chain_balance;
      let isAnnounced = false;
      const limit = channelLimit;

      const maxTokens = balance > limit ? limit : balance;

      const channelAmount = args.local_tokens ? args.local_tokens : maxTokens;

      const options = {
        local_funding_amount: channelAmount - staticFee,
        node_pubkey: Buffer.from(args.partner_public_key, 'hex'),
      }

      if (!!args.chain_fee_tokens_per_vbyte) {
        options.sat_per_byte = chain_fee_tokens_per_vbyte;
      }

      if (!!args.give_tokens) {
        options.push_sat = args.give_tokens;
      }

      const channelOpen = args.lnd.openChannel(options);

      channelOpen.on('data', chan => {
        switch (chan.update) {
        case 'chan_open':
          break;

        case 'chan_pending':
          if (isAnnounced) {
            break;
          }

          isAnnounced = true;

          return cbk(null, {
            transaction_id: chan.chan_pending.txid.reverse().toString('hex'),
            transaction_vout: chan.chan_pending.output_index,
            type: 'channel_pending',
          })
          break;

        case 'confirmation':
          break;

        default:
          break;
        }
      });

      channelOpen.on('end', () => {});

      channelOpen.on('error', err => {});

      channelOpen.on('status', n => {
        if (isAnnounced) {
          return;
        }

        isAnnounced = true;

        if (!n || !n.details) {
          return cbk([503, 'UnknownChannelOpenStatus']);
        }

        if (/^Unknown.chain/.test(n.details)) {
          return cbk([503, 'ChainUnsupported']);
        }

        switch (n.details) {
        case 'Multiple channels unsupported':
          return cbk([503, 'RemoteNodeDoesNotSupportMultipleChannels']);

        case 'peer disconnected':
          return cbk([503, 'RemotePeerDisconnected']);

        case 'Synchronizing blockchain':
          return cbk([503, 'RemoteNodeSyncing']);

        default:
          return cbk([503, 'FailedToOpenChannel', n]);
        }
      });

      return;
    }],
  },
  returnResult({of: 'openChannel'}, cbk));
};

