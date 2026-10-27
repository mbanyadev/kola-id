// SPDX-License-Identifier: Apache-2.0
// Wallet key derivation (follows the Midnight "Run a wallet in Node.js" guide).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HDWallet, Roles, createKeystore, generateMnemonicWords, validateMnemonic } from '@midnightntwrk/wallet-sdk';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { PRIVATE_DIR } from './config.js';

/** One throwaway recovery phrase for every test network; the address prefix follows the network. */
export const MNEMONIC_FILE = join(PRIVATE_DIR, 'preview-wallet.mnemonic');

export const seedFromMnemonic = (phrase: string): Uint8Array => {
  const mnemonic = phrase.trim().toLowerCase().split(/\s+/).join(' ');
  if (!validateMnemonic(mnemonic)) throw new Error('Not a valid BIP-39 recovery phrase.');
  return mnemonicToSeedSync(mnemonic);
};

/** Create the throwaway wallet phrase once (mode 600); never print it. */
export const ensureMnemonic = (): boolean => {
  if (existsSync(MNEMONIC_FILE)) return false;
  writeFileSync(MNEMONIC_FILE, generateMnemonicWords().join(' ') + '\n', { mode: 0o600, flag: 'wx' });
  return true;
};

/** Read the wallet secret: WALLET_MNEMONIC from the environment, or the private file. */
export const readSeed = (): Uint8Array => {
  if (process.env.WALLET_MNEMONIC) return seedFromMnemonic(process.env.WALLET_MNEMONIC);
  if (existsSync(MNEMONIC_FILE)) return seedFromMnemonic(readFileSync(MNEMONIC_FILE, 'utf8'));
  throw new Error(`No wallet: run "npm run preview:wallet" (or preprod:wallet) or set WALLET_MNEMONIC.`);
};

export const deriveWalletKeys = (seed: Uint8Array) => {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();
  return {
    shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(result.keys[Roles.Zswap]),
    dustSecretKey: ledger.DustSecretKey.fromSeed(result.keys[Roles.Dust]),
    unshieldedKeystore: createKeystore(result.keys[Roles.NightExternal], getNetworkId()),
  };
};
export type WalletKeys = ReturnType<typeof deriveWalletKeys>;
