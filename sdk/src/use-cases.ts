// SPDX-License-Identifier: Apache-2.0
// Use-case presets beyond finance: age checks for betting and gaming, cooperative membership for
// supply-chain buyers, and qualification proofs for job platforms.
//
// The Kola ID contract is unchanged. Each trust domain is its own Kola ID deployment (a "registry")
// whose admin approves only the right kind of issuer:
//   * KYC registry     — licensed KYC providers, banks, mobile-money operators
//   * Co-op registry   — cooperative unions that keep the member roll
//   * Skills registry  — accredited training institutes and exam boards
// Because a proof only says "my credential is in THIS registry's tree and meets THIS policy", a
// co-op union can never mint a KYC credential and a training institute can never mint a co-op
// membership, and a relying app knows exactly which kind of issuer stands behind a yes.
//
// Inside the co-op and skills registries, the credential's generic "issuer check passed on day X"
// pair (`sanctionsClear`, `screenedDay`) carries that registry's own check: "member in good standing"
// (dues paid, roll audited) or "certificate authenticated with the awarding body". `expiryDay` is the
// membership or licence end date. Apps see the same yes/no and per-app nullifier as in the KYC case.
import { KolaSimulator, makeCredential, makePolicy, pureCircuits, type Policy } from './simulator.js';
import type { KolaPrivateState } from './witnesses.js';
import { dayNumber, minAgeDays } from './dates.js';
import { labelBytes32, randomBytes32, COUNTRY } from './keys.js';

export type RegistryKind = 'kyc' | 'coop' | 'skills';
export type UseCaseId = 'gaming' | 'coop' | 'jobs';

export interface Facts {
  dobDay: bigint;
  country: number;
  /** KYC registry: sanctions screening clear. Co-op: member in good standing. Skills: certificate authenticated. */
  checkPassed: boolean;
  /** Day of that check. */
  checkedDay: bigint;
  /** Credential, membership or licence end (exclusive). */
  expiryDay: bigint;
}

export interface UseCasePolicy {
  minAgeYears: number;
  countries: number[];
  /** Require the registry's check (see Facts.checkPassed) to have passed... */
  requireCheck: boolean;
  /** ...at most this many days ago. */
  maxCheckAgeDays: number;
}

export interface FailCase {
  who: string;
  story: string;
  /** 'facts': a real credential that fails the policy. 'unapprovedIssuer': a forger tries to issue. */
  kind: 'facts' | 'unapprovedIssuer';
  facts: (today: bigint) => Facts;
  /** Error text the contract returns (substring). */
  expect: RegExp;
  /** What the app (or the forger) sees. */
  outcome: string;
}

export interface UseCase {
  id: UseCaseId;
  industry: string;
  title: string;
  registry: { kind: RegistryKind; name: string; issuers: string };
  issuer: string;
  app: { name: string; label: string; does: string };
  /** What the registry's generic check means here. */
  checkMeaning: string;
  policy: UseCasePolicy;
  /** Human-readable policy lines, shown to the holder before proving. */
  policyLines: string[];
  /** What the app learns on success. */
  appLearns: string;
  /** Why this buyer needs it (one line; the docs page has the sources). */
  why: string;
  manka: (today: bigint) => Facts;
  fail: FailCase;
  doc: string;
}

const MANKA_DOB = dayNumber('1998-05-14');
const ageDaysAgo = (today: bigint, years: number, extraDays = 0) => today - BigInt(years * 365 + Math.floor(years / 4)) - BigInt(extraDays);

export const USE_CASES: UseCase[] = [
  {
    id: 'gaming',
    industry: 'Gaming and betting',
    title: 'Age check for a betting app (21+)',
    registry: { kind: 'kyc', name: 'Kola KYC registry', issuers: 'licensed KYC providers, banks and mobile-money operators' },
    issuer: 'Kumba Verify',
    app: { name: 'Mboa Bet', label: 'mboa-bet', does: 'online sports betting in Cameroon' },
    checkMeaning: 'ID document verified, sanctions screened',
    policy: { minAgeYears: 21, countries: [COUNTRY.Cameroon], requireCheck: false, maxCheckAgeDays: 0 },
    policyLines: ['Age 21+ (Cameroon: betting is closed to anyone below civil majority, which is 21)', 'Resident in Cameroon', 'One account per person'],
    appLearns: 'a yes and a per-app nullifier: no birth date, no name, no document',
    why: 'Operators must keep minors out and today mostly rely on a sworn age statement plus ID data they then have to store.',
    manka: (t) => ({ dobDay: MANKA_DOB, country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 10n, expiryDay: t + 365n }),
    fail: {
      who: 'Ebai', kind: 'facts', story: 'Ebai is 19: an adult in many countries, but under 21.',
      facts: (t) => ({ dobDay: ageDaysAgo(t, 19, 40), country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 5n, expiryDay: t + 365n }),
      expect: /too young/, outcome: 'Refused: too young. Mboa Bet learns nothing about the actual age.',
    },
    doc: 'docs/use-cases/gaming-age.md',
  },
  {
    id: 'coop',
    industry: 'Agriculture and supply chains',
    title: 'Co-op membership proof for a cocoa buyer',
    registry: { kind: 'coop', name: 'Kola Co-op registry', issuers: 'cooperative unions that keep the member roll' },
    issuer: 'Fako Cocoa Farmers Union',
    app: { name: 'Limbe Cocoa Buyers', label: 'limbe-cocoa', does: 'buys and exports cocoa from member farmers' },
    checkMeaning: 'member in good standing (dues paid, roll audited)',
    policy: { minAgeYears: 18, countries: [COUNTRY.Cameroon], requireCheck: true, maxCheckAgeDays: 365 },
    policyLines: ['Member of an approved cooperative union', 'Good standing re-checked within the last 365 days', 'Adult (18+) supplier', 'Farm in Cameroon', 'One supplier account per member'],
    appLearns: 'that a real, adult, current member of an approved co-op is selling, and a per-buyer nullifier: no name, no member number, not even which co-op',
    why: 'Buyers selling into the EU must trace cocoa back to its farms and keep supplier records; co-ops hold the member roll, but sharing it exposes every farmer to every buyer.',
    manka: (t) => ({ dobDay: MANKA_DOB, country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 30n, expiryDay: t + 335n }),
    fail: {
      who: 'Tabe', kind: 'facts', story: 'Tabe\'s membership was last confirmed 400 days ago (dues not renewed).',
      facts: (t) => ({ dobDay: dayNumber('1985-02-11'), country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 400n, expiryDay: t + 30n }),
      expect: /screening too old/, outcome: 'Refused: good standing not re-checked this season. Ask the co-op to renew.',
    },
    doc: 'docs/use-cases/coop-membership.md',
  },
  {
    id: 'jobs',
    industry: 'Jobs and skills',
    title: 'Qualification proof for a job platform',
    registry: { kind: 'skills', name: 'Kola Skills registry', issuers: 'accredited training institutes and exam boards' },
    issuer: 'Buea Technical Institute',
    app: { name: 'Mboa Jobs', label: 'mboa-jobs', does: 'matches certified solar technicians with installers' },
    checkMeaning: 'certificate authenticated with the awarding body',
    policy: { minAgeYears: 18, countries: [], requireCheck: true, maxCheckAgeDays: 730 },
    policyLines: ['Holds a certificate from an accredited institute in the Skills registry', 'Certificate authenticated within the last 2 years and not expired', 'Adult (18+)', 'One profile per person'],
    appLearns: 'that the candidate is certified, and a per-platform nullifier: no transcript, no ID number, no school name',
    why: 'Employers re-check paper diplomas by hand because forgeries are common; the institute already knows who graduated.',
    manka: (t) => ({ dobDay: MANKA_DOB, country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 60n, expiryDay: t + 1095n }),
    fail: {
      who: 'A forger', kind: 'unapprovedIssuer', story: '"Quick Diploma Centre" is not an accredited institute and tries to issue a certificate.',
      facts: (t) => ({ dobDay: dayNumber('1995-07-01'), country: COUNTRY.Cameroon, checkPassed: true, checkedDay: t - 1n, expiryDay: t + 1095n }),
      expect: /not an approved issuer/, outcome: 'Rejected at issuance: the forged certificate never enters the registry.',
    },
    doc: 'docs/use-cases/job-qualifications.md',
  },
];

export function useCase(id: UseCaseId): UseCase {
  const u = USE_CASES.find((x) => x.id === id);
  if (!u) throw new Error(`unknown use case ${id}`);
  return u;
}

export function policyFor(owner: Uint8Array, p: UseCasePolicy, epoch = 0n): Policy {
  return makePolicy(owner, {
    minAgeDays: minAgeDays(p.minAgeYears), countries: p.countries,
    requireSanctionsClear: p.requireCheck, maxScreenAgeDays: BigInt(p.maxCheckAgeDays), epoch,
  });
}

/** One registry (its own Kola ID deployment) with its approved issuer and one relying app. */
export class UseCaseRegistry {
  readonly sim: KolaSimulator;
  readonly adminSecret = randomBytes32();
  readonly issuerSecret = randomBytes32();
  readonly appSecret = randomBytes32();
  readonly appId: Uint8Array;

  constructor(readonly uc: UseCase, readonly today: bigint) {
    this.sim = new KolaSimulator(this.adminSecret, today);
    this.appId = labelBytes32(uc.app.label);
    this.sim.addIssuer(this.adminSecret, pureCircuits.issuerKey(this.issuerSecret));
    this.sim.setPolicy(this.appSecret, this.appId, policyFor(pureCircuits.appKey(this.appSecret), uc.policy));
  }

  /** The registry's issuer (or, if given, another issuer secret) issues a credential; returns the holder's private state. */
  issue(holderSecret: Uint8Array, f: Facts, issuerSecret: Uint8Array = this.issuerSecret): KolaPrivateState {
    const c = makeCredential(issuerSecret, pureCircuits.holderKey(holderSecret), {
      dobDay: f.dobDay, country: f.country, sanctionsClear: f.checkPassed, screenedDay: f.checkedDay, expiryDay: f.expiryDay,
    });
    this.sim.issueCredential(issuerSecret, c.leaf);
    return { holderSecret, credential: c.credential, salt: c.salt };
  }

  prove(ps: KolaPrivateState, returning = false): Uint8Array {
    return returning ? this.sim.proveReturning(ps, this.appId, this.today) : this.sim.proveForApp(ps, this.appId, this.today);
  }

  get verifications(): bigint {
    return this.sim.ledger.verifications.lookup(this.appId).read();
  }
}

/** Run a use case's failure case; returns the error message (throws if it unexpectedly succeeds). */
export function runFailCase(r: UseCaseRegistry): string {
  const f = r.uc.fail;
  try {
    if (f.kind === 'unapprovedIssuer') {
      r.issue(randomBytes32(), f.facts(r.today), randomBytes32());
    } else {
      const ps = r.issue(randomBytes32(), f.facts(r.today));
      r.prove(ps);
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error(`fail case for ${r.uc.id} unexpectedly succeeded`);
}
