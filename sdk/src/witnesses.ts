// SPDX-License-Identifier: Apache-2.0
// Private state and witness implementations for the Kola ID contract.
// Every witness answers from the caller's own private state; nothing here is sent anywhere.
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Credential, Ledger, Witnesses } from '../../contracts/managed/kola-id/contract/index.js';
import { pureCircuits } from '../../contracts/managed/kola-id/contract/index.js';

export type MerklePath = ReturnType<Witnesses<KolaPrivateState>['credentialPath']>[1];

export interface KolaPrivateState {
  adminSecret?: Uint8Array;
  issuerSecret?: Uint8Array;
  appSecret?: Uint8Array;
  holderSecret?: Uint8Array;
  /** The holder's (or, for revocation, the issuer's copy of the) credential and its salt. */
  credential?: Credential;
  salt?: Uint8Array;
  /** Test hook: force a specific Merkle path instead of looking it up in the ledger. */
  pathOverride?: MerklePath;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`private state has no ${what}`);
  return v;
}

type Ctx = WitnessContext<Ledger, KolaPrivateState>;

export const witnesses: Witnesses<KolaPrivateState> = {
  adminSecret: ({ privateState }: Ctx) => [privateState, need(privateState.adminSecret, 'admin secret')],
  issuerSecret: ({ privateState }: Ctx) => [privateState, need(privateState.issuerSecret, 'issuer secret')],
  appSecret: ({ privateState }: Ctx) => [privateState, need(privateState.appSecret, 'app secret')],
  holderSecret: ({ privateState }: Ctx) => [privateState, need(privateState.holderSecret, 'holder secret')],
  credential: ({ privateState }: Ctx) => [privateState, need(privateState.credential, 'credential')],
  credentialSalt: ({ privateState }: Ctx) => [privateState, need(privateState.salt, 'credential salt')],
  credentialPath: ({ privateState, ledger }: Ctx) => {
    if (privateState.pathOverride) return [privateState, privateState.pathOverride];
    const leaf = pureCircuits.credentialLeaf(
      need(privateState.credential, 'credential'),
      need(privateState.salt, 'credential salt'),
    );
    const path = ledger.credentials.findPathForLeaf(leaf);
    if (!path) throw new Error('credential not found in the registry (revoked or never issued)');
    return [privateState, path as MerklePath];
  },
};
