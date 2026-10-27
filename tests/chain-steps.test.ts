// SPDX-License-Identifier: Apache-2.0
// Runs the exact on-chain story used by the Preview deploy script and the Lace demo (CHAIN_STEPS)
// against the simulator, through a stand-in for the Midnight.js contract and private-state provider.
// This checks the story's role switching and expected outcomes before any tDUST is spent.
import { describe, expect, it } from 'vitest';
import * as superjson from 'superjson';
import { CHAIN_STEPS, newCast, summarizeLedger, PRIVATE_STATE_ID, type DemoCast, type KolaContract, type KolaProviders } from '../sdk/src/chain.js';
import { KolaSimulator } from '../sdk/src/simulator.js';
import type { KolaPrivateState } from '../sdk/src/witnesses.js';
import { TODAY } from './fixtures.js';

function harness(cast: DemoCast) {
  const sim = new KolaSimulator(cast.adminSecret, TODAY);
  const store = new Map<string, KolaPrivateState>();
  let address = '';
  const providers = {
    privateStateProvider: {
      setContractAddress: (a: string) => { address = a; },
      set: async (id: string, ps: KolaPrivateState) => { store.set(`${address}/${id}`, superjson.parse(superjson.stringify(ps))); },
    },
  } as unknown as KolaProviders;
  let block = 0;
  const callTx = new Proxy({}, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      const ps = store.get(`${address}/${PRIVATE_STATE_ID}`) ?? {};
      sim.call(ps, name as never, ...args);
      return { public: { txId: `tx${++block}`, blockHeight: block } };
    },
  });
  return { sim, providers, contract: { callTx } as unknown as KolaContract };
}

describe('the on-chain demo story (CHAIN_STEPS)', () => {
  it('every step lands or is refused exactly as expected', async () => {
    const cast = newCast(TODAY);
    const { sim, providers, contract } = harness(cast);
    const outcomes: Record<string, string> = {};
    for (const step of CHAIN_STEPS) {
      try {
        await step.run(contract, providers, 'addr', cast, TODAY);
        outcomes[step.id] = 'ok';
      } catch (e) {
        outcomes[step.id] = (e as Error).message;
      }
      if (step.expectOk) expect(outcomes[step.id], step.label).toBe('ok');
      else expect(outcomes[step.id], step.label).not.toBe('ok');
    }
    expect(outcomes['manka-sawa-again']).toMatch(/already registered with this app/);
    expect(outcomes['ebai-sawa']).toMatch(/too young/);

    const s = summarizeLedger(sim.ledger);
    expect(s.issuers).toHaveLength(1);
    expect(s.credentialsIssued).toBe(2n);
    expect(s.nullifiers).toBe(2n);
    expect(Object.fromEntries(s.apps.map((a) => [a.appId, a.verifications]))).toEqual({ 'sawa-exchange': 2n, 'ndole-games': 1n });
  });

  it('the demo cast survives the JSON round trip used for private/ files and the private-state store', async () => {
    const cast = superjson.parse<DemoCast>(superjson.stringify(newCast(TODAY)));
    expect(cast.manka.holderSecret).toBeInstanceOf(Uint8Array);
    expect(typeof cast.manka.credential.dobDay).toBe('bigint');
    const { providers, contract } = harness(cast);
    for (const step of CHAIN_STEPS.slice(0, 6)) await step.run(contract, providers, 'addr', cast, TODAY);
  });
});
