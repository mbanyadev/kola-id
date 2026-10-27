// SPDX-License-Identifier: Apache-2.0
// In-process simulator: runs the compiled Kola ID circuits against a local copy of the public
// ledger, one actor (admin, issuer, app, holder) at a time. Used by the tests and the web demo.
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type ContractState,
  type ChargedState,
  type CircuitResults,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
  type Credential,
  type Ledger,
  type Policy,
} from '../../contracts/managed/kola-id/contract/index.js';
import { witnesses, type KolaPrivateState } from './witnesses.js';
import { noonOf } from './dates.js';
import { randomBytes32 } from './keys.js';

export { pureCircuits };
export type { Credential, Policy, Ledger };

const COIN_PK = '0'.repeat(64);

export class KolaSimulator {
  readonly contract = new Contract<KolaPrivateState>(witnesses);
  readonly address = sampleContractAddress();
  private state: ContractState | ChargedState;
  /** Block time used for the next call, in seconds since the Unix epoch. */
  blockTime: number;

  constructor(adminSecret: Uint8Array, today: bigint) {
    const init = this.contract.initialState(createConstructorContext<KolaPrivateState>({ adminSecret }, COIN_PK));
    this.state = init.currentContractState;
    this.blockTime = noonOf(today);
  }

  setToday(day: bigint): void {
    this.blockTime = noonOf(day);
  }

  get ledger(): Ledger {
    const st = this.state as ContractState & ChargedState;
    return ledger('data' in st && st.data ? st.data : st);
  }

  /** Run one circuit as an actor with the given private state. The ledger only changes on success. */
  private run<R>(ps: KolaPrivateState, f: (ctx: CircuitContext<KolaPrivateState>) => CircuitResults<KolaPrivateState, R>): R {
    const ctx = createCircuitContext<KolaPrivateState>(this.address, COIN_PK, this.state, ps, undefined, undefined, this.blockTime);
    const res = f(ctx);
    this.state = res.context.currentQueryContext.state;
    return res.result;
  }

  addIssuer(adminSecret: Uint8Array, issuerPk: Uint8Array): void {
    this.run({ adminSecret }, (c) => this.contract.impureCircuits.addIssuer(c, issuerPk));
  }
  removeIssuer(adminSecret: Uint8Array, issuerPk: Uint8Array): void {
    this.run({ adminSecret }, (c) => this.contract.impureCircuits.removeIssuer(c, issuerPk));
  }
  issueCredential(issuerSecret: Uint8Array, leaf: Uint8Array): void {
    this.run({ issuerSecret }, (c) => this.contract.impureCircuits.issueCredential(c, leaf));
  }
  revokeCredential(issuerSecret: Uint8Array, credential: Credential, salt: Uint8Array, extra: Partial<KolaPrivateState> = {}): void {
    this.run({ issuerSecret, credential, salt, ...extra }, (c) => this.contract.impureCircuits.revokeCredential(c));
  }
  setPolicy(appSecret: Uint8Array, appId: Uint8Array, policy: Policy): void {
    this.run({ appSecret }, (c) => this.contract.impureCircuits.setPolicy(c, appId, policy));
  }
  proveForApp(holder: KolaPrivateState, appId: Uint8Array, today: bigint): Uint8Array {
    return this.run(holder, (c) => this.contract.impureCircuits.proveForApp(c, appId, today));
  }
  proveReturning(holder: KolaPrivateState, appId: Uint8Array, today: bigint): Uint8Array {
    return this.run(holder, (c) => this.contract.impureCircuits.proveReturning(c, appId, today));
  }

  /** Call any impure circuit by name with a given private state (used to check the on-chain story offline). */
  call(ps: KolaPrivateState, circuit: keyof Contract<KolaPrivateState>['impureCircuits'], ...args: unknown[]): unknown {
    const f = this.contract.impureCircuits[circuit] as unknown as (c: CircuitContext<KolaPrivateState>, ...a: unknown[]) => CircuitResults<KolaPrivateState, unknown>;
    return this.run(ps, (c) => f(c, ...args));
  }

  /** Full proof transcript of a call, for inspecting exactly what becomes public. */
  proveForAppTranscript(holder: KolaPrivateState, appId: Uint8Array, today: bigint) {
    const ctx = createCircuitContext<KolaPrivateState>(this.address, COIN_PK, this.state, holder, undefined, undefined, this.blockTime);
    return this.contract.impureCircuits.proveForApp(ctx, appId, today).proofData;
  }
}

/** Issuer-side helper: build a credential for a holder and the leaf commitment to publish. */
export function makeCredential(
  issuerSecret: Uint8Array,
  holderPk: Uint8Array,
  attrs: { dobDay: bigint; country: number; sanctionsClear: boolean; screenedDay: bigint; expiryDay: bigint },
  salt: Uint8Array = randomBytes32(),
): { credential: Credential; salt: Uint8Array; leaf: Uint8Array } {
  const credential: Credential = {
    holderPk,
    issuerPk: pureCircuits.issuerKey(issuerSecret),
    dobDay: attrs.dobDay,
    country: BigInt(attrs.country),
    sanctionsClear: attrs.sanctionsClear,
    screenedDay: attrs.screenedDay,
    expiryDay: attrs.expiryDay,
  };
  return { credential, salt, leaf: pureCircuits.credentialLeaf(credential, salt) };
}

export function makePolicy(owner: Uint8Array, p: Partial<Omit<Policy, 'owner' | 'countries'>> & { countries?: number[] } = {}): Policy {
  const countries = (p.countries ?? []).map(BigInt);
  if (countries.length > 8) throw new Error('at most 8 countries');
  while (countries.length < 8) countries.push(0n);
  return {
    owner,
    minAgeDays: p.minAgeDays ?? 0n,
    countries,
    requireSanctionsClear: p.requireSanctionsClear ?? false,
    maxScreenAgeDays: p.maxScreenAgeDays ?? 0n,
    epoch: p.epoch ?? 0n,
  };
}
