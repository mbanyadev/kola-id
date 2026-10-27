// SPDX-License-Identifier: Apache-2.0
// Shared Midnight.js glue for running Kola ID on a real network (Preview), used by the Node deploy
// script and by the demo's "Lace / Preview" mode. Works in Node 22+ and in the browser.
import { deployContract, findDeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import * as Kola from '../../contracts/managed/kola-id/contract/index.js';
import { witnesses, type KolaPrivateState } from './witnesses.js';
import { makeCredential, makePolicy } from './simulator.js';
import { dayNumber, minAgeDays } from './dates.js';
import { COUNTRY, labelBytes32, randomBytes32, toHex } from './keys.js';

export type KolaCircuits = keyof Kola.ProvableCircuits<KolaPrivateState>;
export const PRIVATE_STATE_ID = 'kolaIdPrivateState';
export type KolaProviders = MidnightProviders<KolaCircuits, typeof PRIVATE_STATE_ID, KolaPrivateState>;
export type KolaContract = FoundContract<Kola.Contract<KolaPrivateState>>;

export const compiledKola = (assetPath: string) =>
  CompiledContract.make('kola-id', Kola.Contract<KolaPrivateState>).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(assetPath),
  );

/** Today's day number (UTC), as the contract expects it; must match block time. */
export const todayUtc = (): bigint => dayNumber(new Date().toISOString().slice(0, 10));

export const SAWA_ID = labelBytes32('sawa-exchange');
export const NDOLE_ID = labelBytes32('ndole-games');

/** Secrets for every demo role. On Preview one wallet plays all roles; each role's secret is separate. */
export interface DemoCast {
  adminSecret: Uint8Array;
  kumbaSecret: Uint8Array;
  sawaSecret: Uint8Array;
  ndoleSecret: Uint8Array;
  manka: Required<Pick<KolaPrivateState, 'holderSecret' | 'credential' | 'salt'>>;
  ebai: Required<Pick<KolaPrivateState, 'holderSecret' | 'credential' | 'salt'>>;
}

export function newCast(today = todayUtc()): DemoCast {
  const kumbaSecret = randomBytes32();
  const holder = (dob: string, screenedAgo: bigint) => {
    const holderSecret = randomBytes32();
    const c = makeCredential(kumbaSecret, Kola.pureCircuits.holderKey(holderSecret), {
      dobDay: dayNumber(dob), country: COUNTRY.Cameroon, sanctionsClear: true,
      screenedDay: today - screenedAgo, expiryDay: today + 365n,
    });
    return { holderSecret, credential: c.credential, salt: c.salt };
  };
  return {
    adminSecret: randomBytes32(), kumbaSecret, sawaSecret: randomBytes32(), ndoleSecret: randomBytes32(),
    manka: holder('1998-05-14', 10n),
    ebai: holder('2009-03-02', 5n),
  };
}

export const leafOf = (h: DemoCast['manka']) => Kola.pureCircuits.credentialLeaf(h.credential, h.salt);

/** Run one circuit call as a given role: put that role's private state in place, then call. */
export async function asRole<T>(providers: KolaProviders, address: string, ps: KolaPrivateState, call: () => Promise<T>): Promise<T> {
  providers.privateStateProvider.setContractAddress(address);
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, ps);
  return call();
}

export async function deployKola(providers: KolaProviders, assetPath: string, cast: DemoCast) {
  return deployContract(providers, {
    compiledContract: compiledKola(assetPath),
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: { adminSecret: cast.adminSecret },
  });
}

export async function joinKola(providers: KolaProviders, assetPath: string, address: string, ps: KolaPrivateState = {}) {
  providers.privateStateProvider.setContractAddress(address);
  return findDeployedContract(providers, {
    contractAddress: address,
    compiledContract: compiledKola(assetPath),
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: ps,
  }) as Promise<KolaContract>;
}

export interface ChainStep {
  id: string;
  label: string;
  /** Expected outcome: true if the transaction should land, false if the proof should be refused locally. */
  expectOk: boolean;
  run: (c: KolaContract, p: KolaProviders, address: string, cast: DemoCast, today: bigint) => Promise<unknown>;
}

const kumbaPk = (cast: DemoCast) => Kola.pureCircuits.issuerKey(cast.kumbaSecret);

/** The guided story, on-chain. Failing steps are rejected by the local proof (no fee is paid). */
export const CHAIN_STEPS: ChainStep[] = [
  { id: 'add-issuer', label: 'Admin approves Kumba Verify', expectOk: true,
    run: (c, p, a, cast) => asRole(p, a, { adminSecret: cast.adminSecret }, () => c.callTx.addIssuer(kumbaPk(cast))) },
  { id: 'issue-manka', label: 'Kumba Verify issues a credential to Manka', expectOk: true,
    run: (c, p, a, cast) => asRole(p, a, { issuerSecret: cast.kumbaSecret }, () => c.callTx.issueCredential(leafOf(cast.manka))) },
  { id: 'issue-ebai', label: 'Kumba Verify issues a credential to Ebai', expectOk: true,
    run: (c, p, a, cast) => asRole(p, a, { issuerSecret: cast.kumbaSecret }, () => c.callTx.issueCredential(leafOf(cast.ebai))) },
  { id: 'policy-sawa', label: 'Sawa Exchange publishes its policy (18+, CM/GH/KE/NG, sanctions ≤ 90 days)', expectOk: true,
    run: (c, p, a, cast) => asRole(p, a, { appSecret: cast.sawaSecret }, () =>
      c.callTx.setPolicy(SAWA_ID, makePolicy(Kola.pureCircuits.appKey(cast.sawaSecret), {
        minAgeDays: minAgeDays(18), countries: [COUNTRY.Cameroon, COUNTRY.Ghana, COUNTRY.Kenya, COUNTRY.Nigeria],
        requireSanctionsClear: true, maxScreenAgeDays: 90n,
      }))) },
  { id: 'policy-ndole', label: 'Ndole Games publishes its policy (18+)', expectOk: true,
    run: (c, p, a, cast) => asRole(p, a, { appSecret: cast.ndoleSecret }, () =>
      c.callTx.setPolicy(NDOLE_ID, makePolicy(Kola.pureCircuits.appKey(cast.ndoleSecret), { minAgeDays: minAgeDays(18) }))) },
  { id: 'manka-sawa', label: 'Manka signs up to Sawa Exchange', expectOk: true,
    run: (c, p, a, cast, today) => asRole(p, a, cast.manka, () => c.callTx.proveForApp(SAWA_ID, today)) },
  { id: 'manka-sawa-again', label: 'Manka tries a second Sawa Exchange account', expectOk: false,
    run: (c, p, a, cast, today) => asRole(p, a, cast.manka, () => c.callTx.proveForApp(SAWA_ID, today)) },
  { id: 'manka-ndole', label: 'Manka signs up to Ndole Games', expectOk: true,
    run: (c, p, a, cast, today) => asRole(p, a, cast.manka, () => c.callTx.proveForApp(NDOLE_ID, today)) },
  { id: 'ebai-sawa', label: 'Ebai (17) tries Sawa Exchange', expectOk: false,
    run: (c, p, a, cast, today) => asRole(p, a, cast.ebai, () => c.callTx.proveForApp(SAWA_ID, today)) },
  { id: 'manka-return', label: 'Manka logs back in to Sawa Exchange', expectOk: true,
    run: (c, p, a, cast, today) => asRole(p, a, cast.manka, () => c.callTx.proveReturning(SAWA_ID, today)) },
];

/** Public, non-secret summary of the ledger for display. */
export function summarizeLedger(l: Kola.Ledger) {
  const name = (k: Uint8Array) => new TextDecoder().decode(k).replace(/\0+$/, '');
  const apps = [...l.policies].map(([k, v]) => ({
    appId: name(k), minAgeYearsApprox: Number(v.minAgeDays) / 365.25, epoch: v.epoch,
    verifications: l.verifications.member(k) ? l.verifications.lookup(k).read() : 0n,
  }));
  return {
    admin: toHex(l.admin),
    issuers: [...l.issuers].map(toHex),
    credentialsIssued: l.issuedCount,
    credentialsRevoked: l.revokedCount,
    credentialRoot: l.credentials.root().field.toString(16),
    apps,
    nullifiers: l.nullifiers.size(),
  };
}
