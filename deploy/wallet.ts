// SPDX-License-Identifier: Apache-2.0
// WalletFacade setup, state snapshots and submit-with-retry (from the Midnight Node.js wallet guide).
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, PublicKey, NoOpTransactionHistoryStorage,
} from '@midnightntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CONFIG, PRIVATE_DIR, checkIndexer } from './config.js';
import { type WalletKeys } from './keys.js';

export type SavedWalletState = { shielded: string; unshielded: string; dust: string };

export const walletStateFile = (keys: WalletKeys): string =>
  join(PRIVATE_DIR, `wallet-state-${getNetworkId()}-${keys.unshieldedKeystore.getBech32Address()}.json`);

export const loadWalletState = async (file: string): Promise<SavedWalletState | undefined> =>
  existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as SavedWalletState) : undefined;

export const saveWalletState = async (wallet: WalletFacade, file: string): Promise<void> => {
  const snapshot: SavedWalletState = {
    shielded: await wallet.shielded.serializeState(),
    unshielded: await wallet.unshielded.serializeState(),
    dust: await wallet.dust.serializeState(),
  };
  await writeFile(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
};

export const buildWallet = async (keys: WalletKeys, saved?: SavedWalletState): Promise<WalletFacade> => {
  const { shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = keys;
  console.log(`Indexer OK, chain height ${await checkIndexer()}`);
  const wallet = await WalletFacade.init({
    configuration: {
      networkId: getNetworkId(),
      indexerClientConnection: { indexerHttpUrl: CONFIG.indexerHttpUrl, indexerWsUrl: CONFIG.indexerWsUrl },
      provingServerUrl: new URL(CONFIG.proofServer),
      relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    },
    shielded: (cfg) => (saved ? ShieldedWallet(cfg).restore(saved.shielded) : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys)),
    unshielded: (cfg) =>
      saved ? UnshieldedWallet(cfg).restore(saved.unshielded) : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      saved ? DustWallet(cfg).restore(saved.dust) : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return wallet;
};

export const submitWithRetry = async (wallet: WalletFacade, tx: FinalizedTransaction, attempts = 3): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await wallet.submitTransaction(tx);
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.warn(`Submission attempt ${attempt} failed, trying again`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
};

/**
 * Log sync progress every 30 s until the wallet is synced (a fresh wallet can take a long while on Preprod),
 * and, when a state file is given, checkpoint the wallet state every 2 minutes so an interrupted sync resumes.
 */
export const logSyncProgress = (wallet: WalletFacade, checkpointFile?: string): (() => void) => {
  const fmt = (p: unknown) =>
    p && typeof p === 'object'
      ? JSON.stringify(p, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      : String(p);
  let last: { isSynced?: boolean; shielded?: { progress?: unknown }; unshielded?: { progress?: unknown }; dust?: { progress?: unknown } } = {};
  const sub = wallet.state().subscribe((s) => (last = s as typeof last));
  const t = setInterval(() => {
    if (last.isSynced) return;
    console.log(`[sync ${new Date().toISOString().slice(11, 19)}] shielded ${fmt(last.shielded?.progress)} | unshielded ${fmt(last.unshielded?.progress)} | dust ${fmt(last.dust?.progress)}`);
  }, 30_000);
  let saving = false;
  const c = checkpointFile
    ? setInterval(() => {
        if (saving || last.isSynced) return;
        saving = true;
        saveWalletState(wallet, checkpointFile).catch((e: Error) => console.warn(`Checkpoint failed: ${e.message}`)).finally(() => (saving = false));
      }, 120_000)
    : undefined;
  return () => { clearInterval(t); if (c) clearInterval(c); sub.unsubscribe(); };
};
