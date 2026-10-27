// SPDX-License-Identifier: Apache-2.0
// Network configuration for the Kola ID deploy scripts. Imported first by every script.
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const NETWORK_ID = process.env.MIDNIGHT_NETWORK ?? 'preview';
setNetworkId(NETWORK_ID);

/** Midnight-hosted Preview endpoints (no token). The proof server always runs locally. */
export const CONFIG = {
  indexerHttpUrl: process.env.INDEXER_HTTP ?? 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUrl: process.env.INDEXER_WS ?? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: process.env.NODE_RPC ?? 'https://rpc.preview.midnight.network',
  proofServer: process.env.PROOF_SERVER ?? 'http://127.0.0.1:6300',
};

/**
 * Directory for everything secret or wallet-specific: recovery phrase, wallet state, private-state
 * password and LevelDB store. It is gitignored and must stay outside version control.
 */
export const PRIVATE_DIR = resolve(process.env.KOLA_PRIVATE_DIR ?? new URL('../private', import.meta.url).pathname);
mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });

export const CONTRACT_DIR = new URL('../contracts/managed/kola-id', import.meta.url).pathname;
export const DEPLOYMENT_FILE = new URL('./preview-deployment.json', import.meta.url).pathname;
