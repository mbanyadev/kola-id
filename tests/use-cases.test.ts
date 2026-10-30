// SPDX-License-Identifier: Apache-2.0
// Use cases beyond finance, each on its own Kola ID registry (same contract, separate deployment).
import { describe, expect, it } from 'vitest';
import {
  USE_CASES, UseCaseRegistry, runFailCase, useCase, randomBytes32, toHex, sameBytes, type KolaPrivateState,
} from '../sdk/src/index.js';
import { TODAY } from './fixtures.js';

describe('use cases beyond finance (one registry per trust domain)', () => {
  for (const uc of USE_CASES) {
    it(`${uc.id}: Manka passes ${uc.app.name}'s policy, once per person`, () => {
      const r = new UseCaseRegistry(uc, TODAY);
      const manka = r.issue(randomBytes32(), uc.manka(TODAY));
      const nf = r.prove(manka);
      expect(nf).toHaveLength(32);
      expect(r.verifications).toBe(1n);
      expect(() => r.prove(manka)).toThrow(/already registered/);
      expect(sameBytes(r.prove(manka, true), nf)).toBe(true); // returning login
    });

    it(`${uc.id}: ${uc.fail.who} is refused (${uc.fail.expect.source})`, () => {
      const r = new UseCaseRegistry(uc, TODAY);
      expect(runFailCase(r)).toMatch(uc.fail.expect);
      expect(r.verifications).toBe(0n);
    });
  }

  it('one person, three apps: three different nullifiers, nothing joinable', () => {
    const mankaSecret = randomBytes32();
    const nfs = USE_CASES.map((uc) => {
      const r = new UseCaseRegistry(uc, TODAY);
      return toHex(r.prove(r.issue(mankaSecret, uc.manka(TODAY))));
    });
    expect(new Set(nfs).size).toBe(3);
  });

  it("an issuer approved in one registry cannot issue into another (a co-op can't mint KYC)", () => {
    const coop = new UseCaseRegistry(useCase('coop'), TODAY);
    const gaming = new UseCaseRegistry(useCase('gaming'), TODAY);
    expect(() => gaming.issue(randomBytes32(), useCase('gaming').manka(TODAY), coop.issuerSecret)).toThrow(/not an approved issuer/);
  });

  it("a credential from one registry does not verify in another", () => {
    const coop = new UseCaseRegistry(useCase('coop'), TODAY);
    const jobs = new UseCaseRegistry(useCase('jobs'), TODAY);
    const ps: KolaPrivateState = coop.issue(randomBytes32(), useCase('jobs').manka(TODAY));
    expect(() => jobs.prove(ps)).toThrow(/not found in the registry|unknown or revoked/);
  });

  it('gaming: 21 is the threshold, not 18', () => {
    const uc = useCase('gaming');
    const r = new UseCaseRegistry(uc, TODAY);
    const twenty = r.issue(randomBytes32(), { ...uc.manka(TODAY), dobDay: TODAY - BigInt(20 * 365 + 5 + 100) });
    expect(() => r.prove(twenty)).toThrow(/too young/);
    const twentyTwo = r.issue(randomBytes32(), { ...uc.manka(TODAY), dobDay: TODAY - BigInt(22 * 365 + 5) });
    expect(r.prove(twentyTwo)).toHaveLength(32);
  });

  it('jobs: an expired licence is refused even if it was authenticated', () => {
    const uc = useCase('jobs');
    const r = new UseCaseRegistry(uc, TODAY);
    const ps = r.issue(randomBytes32(), { ...uc.manka(TODAY), expiryDay: TODAY });
    expect(() => r.prove(ps)).toThrow(/expired/);
  });
});
