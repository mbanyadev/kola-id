// SPDX-License-Identifier: Apache-2.0
// Create the throwaway Preview wallet (first run only), sync it, and print its address and balances.
// The recovery phrase is written to private/ with mode 600 and is never printed.
import './config.js';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { deriveWalletKeys, ensureMnemonic, readSeed } from './keys.js';
import { buildWallet, loadWalletState, logSyncProgress, saveWalletState, walletStateFile } from './wallet.js';

if (ensureMnemonic()) console.log('Created a new throwaway wallet (recovery phrase saved in private/, mode 600).');
const keys = deriveWalletKeys(readSeed());
console.log(`Unshielded address: ${keys.unshieldedKeystore.getBech32Address()}`);
if (process.argv.includes('--address-only')) process.exit(0);

const file = walletStateFile(keys);
const wallet = await buildWallet(keys, await loadWalletState(file));
const stopLog = logSyncProgress(wallet);
const state = await wallet.waitForSyncedState();
stopLog();
const night = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
const registered = state.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration === true).length;
console.log(`tNIGHT: ${Number(night) / 1e6} (${state.unshielded.availableCoins.length} UTXO, ${registered} registered for DUST)`);
console.log(`tDUST: ${Number(state.dust.balance(new Date())) / 1e15}`);
await saveWalletState(wallet, file);
await wallet.stop();
process.exit(0);
