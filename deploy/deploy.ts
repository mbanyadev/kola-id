// SPDX-License-Identifier: Apache-2.0
// Deploy Kola ID to Midnight Preview and run the demo story on-chain.
//   npm run preview:deploy | preprod:deploy   deploy (once) + run every story step not yet recorded
// Needs: Node 22.12+, a proof server on :6300, and a funded throwaway wallet (npm run preview:wallet / preprod:wallet).
// Secrets (wallet phrase, demo-role secrets, private-state password, LevelDB) live only in private/.
import { CONFIG, CONTRACT_DIR, DEPLOYMENT_FILE, NETWORK_ID, PRIVATE_DIR } from './config.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as Rx from 'rxjs';
import * as superjson from 'superjson';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { unshieldedToken, type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { ledger } from '../contracts/managed/kola-id/contract/index.js';
import {
  CHAIN_STEPS, deployKola, joinKola, newCast, summarizeLedger, todayUtc,
  type DemoCast, type KolaCircuits, type KolaProviders,
} from '../sdk/src/chain.js';
import { deriveWalletKeys, readSeed } from './keys.js';
import { buildWallet, loadWalletState, logSyncProgress, saveWalletState, submitWithRetry, walletStateFile } from './wallet.js';

const FAUCET = CONFIG.faucet;

/** Public record of the deployment (committed; contains no secrets). */
interface Deployment {
  network: string;
  contractAddress?: string;
  deployTxId?: string;
  deployBlock?: number;
  deployedAt?: string;
  steps: Record<string, { label: string; ok: boolean; txId?: string; block?: number; refused?: string; at: string }>;
}
const loadDeployment = (): Deployment =>
  existsSync(DEPLOYMENT_FILE) ? JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) : { network: NETWORK_ID, steps: {} };
const saveDeployment = (d: Deployment) => writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + '\n');

/** A private file holding a secret value, created once with mode 600. */
function privateValue<T>(name: string, make: () => T): T {
  const file = join(PRIVATE_DIR, name);
  if (!existsSync(file)) writeFileSync(file, superjson.stringify(make()), { mode: 0o600, flag: 'wx' });
  return superjson.parse<T>(readFileSync(file, 'utf8'));
}

// 0. Proof server
const ps = await fetch(`${CONFIG.proofServer}/version`).then((r) => r.text()).catch(() => '');
if (!ps) throw new Error(`No proof server at ${CONFIG.proofServer}. Start it: docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3`);
console.log(`Proof server ${ps.trim()} at ${CONFIG.proofServer}; network ${NETWORK_ID}`);

// 1. Wallet
const keys = deriveWalletKeys(readSeed());
const { shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = keys;
const address = unshieldedKeystore.getBech32Address().asString();
const stateFile = walletStateFile(keys);
const wallet = await buildWallet(keys, await loadWalletState(stateFile));
const stopLog = logSyncProgress(wallet, stateFile);
let state = await wallet.waitForSyncedState();
stopLog();
await saveWalletState(wallet, stateFile);
const night = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
console.log(`Wallet ${address}: ${Number(night) / 1e6} tNIGHT`);
if (night === 0n) {
  console.log(`\nThe wallet has no tNIGHT. Request it at ${FAUCET} for:\n  ${address}\nthen run this again.`);
  await wallet.stop();
  process.exit(2);
}

// 2. DUST: register NIGHT for DUST generation, then wait for a DUST balance
const unregistered = state.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration !== true);
if (unregistered.length > 0) {
  const { fee } = await wallet.estimateRegistration(unregistered);
  await wallet.waitForGeneratedDust(unregistered, fee);
  const recipe = await wallet.registerNightUtxosForDustGeneration(
    unregistered, unshieldedKeystore.getPublicKey(), (payload) => unshieldedKeystore.signData(payload),
  );
  await submitWithRetry(wallet, await wallet.finalizeRecipe(recipe));
  console.log(`Registered ${unregistered.length} NIGHT UTXO(s) for DUST generation`);
}
state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n)));
console.log(`tDUST: ${Number(state.dust.balance(new Date())) / 1e15}`);
await saveWalletState(wallet, stateFile);

// 3. Providers
const walletProvider = {
  getCoinPublicKey: () => shieldedSecretKeys.coinPublicKey,
  getEncryptionPublicKey: () => shieldedSecretKeys.encryptionPublicKey,
  balanceTx: async (tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> =>
    wallet.finalizeRecipe(await wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys, dustSecretKey }, { ttl })),
  submitTx: (tx: FinalizedTransaction) => submitWithRetry(wallet, tx),
};
const password = privateValue('private-state-password.json', () => `Kola-${randomBytes(18).toString('base64url')}#9`);
const zkConfigProvider = new NodeZkConfigProvider<KolaCircuits>(CONTRACT_DIR);
const providers = {
  privateStateProvider: levelPrivateStateProvider({
    midnightDbName: join(PRIVATE_DIR, 'midnight-level-db'),
    privateStateStoreName: 'kola-private-state',
    signingKeyStoreName: 'kola-signing-keys',
    privateStoragePasswordProvider: () => password,
    accountId: address,
  }),
  publicDataProvider: indexerPublicDataProvider(CONFIG.indexerHttpUrl, CONFIG.indexerWsUrl),
  zkConfigProvider,
  proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
  walletProvider,
  midnightProvider: walletProvider,
} as unknown as KolaProviders;

// 4. Deploy once, then run the story steps not yet recorded
const cast = privateValue<DemoCast>(`demo-cast-${NETWORK_ID}.json`, () => newCast());
const dep = loadDeployment();
let contract;
if (!dep.contractAddress) {
  console.log('Deploying Kola ID (proving the constructor, about a minute)...');
  const deployed = await deployKola(providers, CONTRACT_DIR, cast);
  const pub = deployed.deployTxData.public;
  Object.assign(dep, { contractAddress: pub.contractAddress, deployTxId: pub.txId, deployBlock: pub.blockHeight, deployedAt: new Date().toISOString() });
  saveDeployment(dep);
  console.log(`Deployed at ${pub.contractAddress} (tx ${pub.txId}, block ${pub.blockHeight})`);
  contract = deployed;
} else {
  console.log(`Joining ${dep.contractAddress}`);
  contract = await joinKola(providers, CONTRACT_DIR, dep.contractAddress, { adminSecret: cast.adminSecret });
}
const addr = dep.contractAddress!;
const today = todayUtc();
for (const step of CHAIN_STEPS) {
  if (dep.steps[step.id]) continue;
  process.stdout.write(`${step.label} ... `);
  const at = new Date().toISOString();
  try {
    const r = (await step.run(contract as never, providers, addr, cast, today)) as { public: { txId: string; blockHeight: number } };
    dep.steps[step.id] = { label: step.label, ok: true, txId: r.public.txId, block: r.public.blockHeight, at };
    console.log(`landed (block ${r.public.blockHeight})${step.expectOk ? '' : '  UNEXPECTED'}`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const reason = /failed assert: (.*)/.exec(msg)?.[1] ?? msg.split('\n')[0];
    if (step.expectOk) { saveDeployment(dep); throw e; }
    dep.steps[step.id] = { label: step.label, ok: false, refused: reason, at };
    console.log(`refused as expected: ${reason}`);
  }
  saveDeployment(dep);
  await saveWalletState(wallet, stateFile);
}

// 5. Read the public ledger back from the indexer
const cs = await providers.publicDataProvider.queryContractState(addr);
console.log(`Public ledger on ${NETWORK_ID}:`, superjson.stringify(summarizeLedger(ledger(cs!.data))));
await saveWalletState(wallet, stateFile);
await wallet.stop();
process.exit(0);
