// SPDX-License-Identifier: Apache-2.0
// Midnight.js providers backed by the Lace DApp Connector (API 4.x), per the Midnight browser-DApp guide.
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CostModel, Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { fromHex, toHex, validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { PRIVATE_STATE_ID, type KolaCircuits, type KolaProviders } from '../../../sdk/src/chain.js';
import type { KolaPrivateState } from '../../../sdk/src/witnesses.js';

async function walletBridge(api: ConnectedAPI): Promise<WalletProvider & MidnightProvider> {
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await api.getShieldedAddresses();
  return {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    balanceTx: async (tx) => {
      const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize('signature', 'proof', 'binding', fromHex(balanced.tx));
    },
    submitTx: async (tx) => {
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };
}

export async function connectLace(wallet: InitialAPI, password: string, networkId: string, indexer: string, indexerWs: string) {
  validatePassword(password);
  const api = await wallet.connect(networkId);
  const status = await api.getConnectionStatus();
  if (status.status !== 'connected' || status.networkId !== networkId) throw new Error(`Switch the wallet to ${networkId}.`);
  setNetworkId(networkId);
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  // ZK keys and ZKIR are served next to this page under zk/keys and zk/zkir.
  const zkConfigProvider = new FetchZkConfigProvider<KolaCircuits>(new URL('zk', location.href).href.replace(/\/$/, ''), fetch.bind(window));
  const bridge = await walletBridge(api);
  const providers = {
    privateStateProvider: levelPrivateStateProvider<typeof PRIVATE_STATE_ID, KolaPrivateState>({
      privateStoragePasswordProvider: () => password,
      accountId: unshieldedAddress,
    }),
    // Lace's default indexer for Preview can be stale, so name the Midnight-hosted one.
    publicDataProvider: indexerPublicDataProvider(indexer, indexerWs),
    zkConfigProvider,
    proofProvider: await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()),
    walletProvider: bridge,
    midnightProvider: bridge,
  } as unknown as KolaProviders;
  return { api, providers, address: unshieldedAddress };
}
