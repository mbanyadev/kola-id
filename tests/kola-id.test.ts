// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  pureCircuits, makePolicy, makeCredential, randomBytes32, labelBytes32, toHex, dayNumber, minAgeDays, COUNTRY,
} from '../sdk/src/index.js';
import { TODAY, world, holderWith } from './fixtures.js';

const eq = (a: Uint8Array, b: Uint8Array) => toHex(a) === toHex(b);

describe('deployment and issuer registry', () => {
  it('stores only the admin key hash', () => {
    const w = world();
    expect(eq(w.sim.ledger.admin, pureCircuits.adminKey(w.adminSecret))).toBe(true);
    expect(w.sim.ledger.issuers.member(w.kumbaPk)).toBe(true);
    expect(w.sim.ledger.issuedCount).toBe(2n);
  });

  it('rejects addIssuer / removeIssuer from anyone but the admin', () => {
    const w = world();
    const rogue = randomBytes32();
    expect(() => w.sim.addIssuer(rogue, pureCircuits.issuerKey(rogue))).toThrow(/not admin/);
    expect(() => w.sim.removeIssuer(rogue, w.kumbaPk)).toThrow(/not admin/);
    expect(w.sim.ledger.issuers.member(pureCircuits.issuerKey(rogue))).toBe(false);
  });

  it('rejects credentials from an unapproved issuer', () => {
    const w = world();
    const rogue = randomBytes32();
    const c = makeCredential(rogue, pureCircuits.holderKey(randomBytes32()), {
      dobDay: 0n, country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: TODAY, expiryDay: TODAY + 10n,
    });
    expect(() => w.sim.issueCredential(rogue, c.leaf)).toThrow(/not an approved issuer/);
    expect(w.sim.ledger.issuedCount).toBe(2n);
  });

  it('a removed issuer can no longer issue', () => {
    const w = world();
    w.sim.removeIssuer(w.adminSecret, w.kumbaPk);
    expect(w.sim.ledger.issuers.member(w.kumbaPk)).toBe(false);
    expect(() => holderWith(w, {})).toThrow(/not an approved issuer/);
  });
});

describe('app policies', () => {
  it('stores the public policy and a zeroed counter', () => {
    const w = world();
    const p = w.sim.ledger.policies.lookup(w.sawa.id);
    expect(p.minAgeDays).toBe(minAgeDays(18));
    expect(p.requireSanctionsClear).toBe(true);
    expect(w.sim.ledger.verifications.lookup(w.sawa.id).read()).toBe(0n);
  });

  it('only the owner can change a policy, and owner must be the caller', () => {
    const w = world();
    const other = randomBytes32();
    expect(() => w.sim.setPolicy(other, w.sawa.id, makePolicy(pureCircuits.appKey(other)))).toThrow(/not the app owner/);
    expect(() => w.sim.setPolicy(other, labelBytes32('x'), makePolicy(pureCircuits.appKey(w.sawa.secret)))).toThrow(/policy owner must be the caller/);
    w.sim.setPolicy(w.sawa.secret, w.sawa.id, makePolicy(pureCircuits.appKey(w.sawa.secret), { epoch: 1n }));
    expect(w.sim.ledger.policies.lookup(w.sawa.id).epoch).toBe(1n);
  });

  it('proofs for an unknown app fail', () => {
    const w = world();
    expect(() => w.sim.proveForApp(w.mankaPs, labelBytes32('nope'), TODAY)).toThrow(/unknown app/);
  });
});

describe('proveForApp: happy path, sybil resistance, unlinkability', () => {
  it('Manka signs up to Sawa Exchange; the app gets only a nullifier', () => {
    const w = world();
    const nf = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    expect(eq(nf, pureCircuits.nullifierFor(w.sawa.id, 0n, w.mankaSecret))).toBe(true);
    expect(w.sim.ledger.nullifiers.member(nf)).toBe(true);
    expect(w.sim.ledger.verifications.lookup(w.sawa.id).read()).toBe(1n);
  });

  it('a second sign-up by the same person is rejected', () => {
    const w = world();
    w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    expect(() => w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY)).toThrow(/already registered/);
    expect(w.sim.ledger.verifications.lookup(w.sawa.id).read()).toBe(1n);
  });

  it('returning-user proofs need an existing nullifier', () => {
    const w = world();
    expect(() => w.sim.proveReturning(w.mankaPs, w.sawa.id, TODAY)).toThrow(/not registered/);
    const a = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    const b = w.sim.proveReturning(w.mankaPs, w.sawa.id, TODAY);
    expect(eq(a, b)).toBe(true);
    expect(w.sim.ledger.verifications.lookup(w.sawa.id).read()).toBe(2n);
  });

  it('the same person gets different, unlinkable nullifiers at different apps', () => {
    const w = world();
    const a = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    const b = w.sim.proveForApp(w.mankaPs, w.ndole.id, TODAY);
    expect(eq(a, b)).toBe(false);
    expect(w.sim.ledger.nullifiers.size()).toBe(2n);
  });

  it('bumping the epoch opens a fresh window with a new nullifier', () => {
    const w = world();
    const a = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    const p = w.sim.ledger.policies.lookup(w.sawa.id);
    w.sim.setPolicy(w.sawa.secret, w.sawa.id, { ...p, epoch: 1n });
    const b = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    expect(eq(a, b)).toBe(false);
  });
});

describe('policy predicates (all evaluated on private data)', () => {
  it('Ebai (17) is rejected as too young', () => {
    const w = world();
    expect(() => w.sim.proveForApp(w.ebaiPs, w.sawa.id, TODAY)).toThrow(/too young/);
    expect(() => w.sim.proveForApp(w.ebaiPs, w.ndole.id, TODAY)).toThrow(/too young/);
    expect(w.sim.ledger.nullifiers.size()).toBe(0n);
  });

  it('age boundary: passes exactly on the threshold day, fails the day before', () => {
    const w = world();
    const threshold = minAgeDays(18);
    const onTime = holderWith(w, { dobDay: TODAY - threshold });
    const oneDayShort = holderWith(w, { dobDay: TODAY - threshold + 1n });
    expect(() => w.sim.proveForApp(oneDayShort, w.ndole.id, TODAY)).toThrow(/too young/);
    expect(() => w.sim.proveForApp(onTime, w.ndole.id, TODAY)).not.toThrow();
  });

  it('the conservative age rule never passes before the real 18th birthday (leap years)', () => {
    for (const dob of ['2008-02-29', '2008-11-10', '2008-11-11', '2007-03-01']) {
      const d = dayNumber(dob);
      const [y, m, day] = dob.split('-').map(Number);
      const birthday18 = dayNumber(`${y + 18}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`.replace('-02-29', '-03-01'));
      const firstPass = d + minAgeDays(18);
      expect(firstPass >= birthday18).toBe(true);
      expect(firstPass - birthday18 <= 1n).toBe(true);
    }
  });

  it('a policy with no age check accepts a minor', () => {
    const w = world();
    const app = { id: labelBytes32('open'), secret: randomBytes32() };
    w.sim.setPolicy(app.secret, app.id, makePolicy(pureCircuits.appKey(app.secret)));
    expect(() => w.sim.proveForApp(w.ebaiPs, app.id, TODAY)).not.toThrow();
  });

  it('country outside the allow-list is rejected; empty list means any country', () => {
    const w = world();
    const french = holderWith(w, { country: COUNTRY.France });
    expect(() => w.sim.proveForApp(french, w.sawa.id, TODAY)).toThrow(/country not allowed/);
    expect(() => w.sim.proveForApp(french, w.ndole.id, TODAY)).not.toThrow();
    const ghanaian = holderWith(w, { country: COUNTRY.Ghana });
    expect(() => w.sim.proveForApp(ghanaian, w.sawa.id, TODAY)).not.toThrow();
  });

  it('country 0 cannot match an empty slot', () => {
    const w = world();
    const zero = holderWith(w, { country: 0 });
    expect(() => w.sim.proveForApp(zero, w.sawa.id, TODAY)).toThrow(/country not allowed/);
  });

  it('sanctions: a hit is rejected; screening must be fresh and not in the future', () => {
    const w = world();
    const hit = holderWith(w, { sanctionsClear: false });
    expect(() => w.sim.proveForApp(hit, w.sawa.id, TODAY)).toThrow(/screening not clear/);
    const old = holderWith(w, { screenedDay: TODAY - 91n });
    expect(() => w.sim.proveForApp(old, w.sawa.id, TODAY)).toThrow(/screening too old/);
    const edge = holderWith(w, { screenedDay: TODAY - 90n });
    expect(() => w.sim.proveForApp(edge, w.sawa.id, TODAY)).not.toThrow();
    const future = holderWith(w, { screenedDay: TODAY + 1n });
    expect(() => w.sim.proveForApp(future, w.sawa.id, TODAY)).toThrow(/screening too old/);
    // an app that does not require screening ignores it
    expect(() => w.sim.proveForApp(hit, w.ndole.id, TODAY)).not.toThrow();
  });

  it('expired credentials are rejected', () => {
    const w = world();
    const expired = holderWith(w, { expiryDay: TODAY });
    expect(() => w.sim.proveForApp(expired, w.ndole.id, TODAY)).toThrow(/expired/);
  });
});

describe('binding and freshness', () => {
  it('a stolen credential is useless without the holder secret', () => {
    const w = world();
    const thief = { ...w.mankaPs, holderSecret: randomBytes32() };
    expect(() => w.sim.proveForApp(thief, w.sawa.id, TODAY)).toThrow(/not the holder/);
  });

  it('a path for a different leaf is rejected', () => {
    const w = world();
    const ebaiPath = w.sim.ledger.credentials.findPathForLeaf(w.ebai.leaf)!;
    expect(() => w.sim.proveForApp({ ...w.mankaPs, pathOverride: ebaiPath as never }, w.sawa.id, TODAY)).toThrow(/path does not match/);
  });

  it('a self-made credential that was never issued is rejected', () => {
    const w = world();
    const secret = randomBytes32();
    const fake = makeCredential(w.kumba.secret, pureCircuits.holderKey(secret), {
      dobDay: 0n, country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: TODAY, expiryDay: TODAY + 10n,
    });
    expect(() => w.sim.proveForApp({ holderSecret: secret, credential: fake.credential, salt: fake.salt }, w.ndole.id, TODAY))
      .toThrow(/not found in the registry/);
  });

  it('`today` must match block time (no back-dating to dodge expiry or freshness)', () => {
    const w = world();
    expect(() => w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY + 1n)).toThrow(/today is in the future/);
    expect(() => w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY - 2n)).toThrow(/today is stale/);
    // one day of slack for transactions that land just after midnight UTC
    expect(() => w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY - 1n)).not.toThrow();
  });
});

describe('revocation', () => {
  it('the issuer revokes Manka; her proofs fail; a re-issued credential works again', () => {
    const w = world();
    const nf = w.sim.proveForApp(w.mankaPs, w.sawa.id, TODAY);
    const oldPath = w.sim.ledger.credentials.findPathForLeaf(w.manka.leaf)!;
    w.sim.revokeCredential(w.kumba.secret, w.manka.credential, w.manka.salt);
    expect(w.sim.ledger.revokedCount).toBe(1n);
    expect(w.sim.ledger.credentials.findPathForLeaf(w.manka.leaf)).toBeUndefined();
    expect(() => w.sim.proveReturning(w.mankaPs, w.sawa.id, TODAY)).toThrow(/not found in the registry/);
    // replaying the old Merkle path against the old root fails on-chain too (history was reset)
    expect(() => w.sim.proveReturning({ ...w.mankaPs, pathOverride: oldPath as never }, w.sawa.id, TODAY))
      .toThrow(/unknown or revoked credential/);

    const fresh = makeCredential(w.kumba.secret, pureCircuits.holderKey(w.mankaSecret), {
      dobDay: dayNumber('1998-05-14'), country: COUNTRY.Cameroon, sanctionsClear: true,
      screenedDay: TODAY, expiryDay: TODAY + 365n,
    });
    w.sim.issueCredential(w.kumba.secret, fresh.leaf);
    const again = { ...w.mankaPs, credential: fresh.credential, salt: fresh.salt };
    // same person, same app: the nullifier is unchanged, so re-issuance does not allow a 2nd account
    expect(() => w.sim.proveForApp(again, w.sawa.id, TODAY)).toThrow(/already registered/);
    expect(eq(w.sim.proveReturning(again, w.sawa.id, TODAY), nf)).toBe(true);
  });

  it('revocation zeroes exactly the right slot; other holders keep working', () => {
    const w = world();
    const extra = [holderWith(w, {}), holderWith(w, {}), holderWith(w, {}), holderWith(w, {}), holderWith(w, {})];
    const target = extra[3]; // leaf index 5
    w.sim.revokeCredential(w.kumba.secret, target.credential!, target.salt!);
    expect(() => w.sim.proveForApp(target, w.ndole.id, TODAY)).toThrow(/not found in the registry/);
    for (const h of [w.mankaPs, extra[0], extra[1], extra[2], extra[4]]) {
      expect(() => w.sim.proveForApp(h, w.ndole.id, TODAY)).not.toThrow();
    }
  });

  it('only the issuing issuer can revoke a credential', () => {
    const w = world();
    const other = randomBytes32();
    w.sim.addIssuer(w.adminSecret, pureCircuits.issuerKey(other));
    expect(() => w.sim.revokeCredential(other, w.manka.credential, w.manka.salt)).toThrow(/not the issuer/);
    expect(w.sim.ledger.revokedCount).toBe(0n);
  });
});

describe('what becomes public', () => {
  // Collect every byte string and number in the public part of a proof (inputs, outputs, transcript).
  function publicBlob(x: unknown, out: string[] = []): string[] {
    if (x instanceof Uint8Array) out.push(toHex(x));
    else if (typeof x === 'bigint' || typeof x === 'number') out.push(String(x));
    else if (Array.isArray(x)) x.forEach((v) => publicBlob(v, out));
    else if (x && typeof x === 'object') Object.values(x).forEach((v) => publicBlob(v, out));
    return out;
  }

  it('a proof never exposes the holder key, credential commitment, salt, secret or attributes', () => {
    const w = world();
    const pd = w.sim.proveForAppTranscript(w.mankaPs, w.sawa.id, TODAY);
    const pub = publicBlob([pd.input, pd.output, pd.publicTranscript]).join('|');
    const c = w.manka.credential;
    for (const secret of [c.holderPk, w.manka.leaf, w.manka.salt, w.mankaSecret, c.issuerPk]) {
      expect(pub.includes(toHex(secret))).toBe(false);
    }
    expect(publicBlob(pd.input)).not.toContain(String(c.dobDay));
    // the nullifier and the app id are the intended public outputs
    expect(pub.includes(toHex(pureCircuits.nullifierFor(w.sawa.id, 0n, w.mankaSecret)))).toBe(true);
  });

  it('the public ledger holds commitments, not attributes', () => {
    const w = world();
    expect(w.sim.ledger.credentials.findPathForLeaf(w.manka.leaf)).toBeDefined();
    const ledgerKeys = Object.keys(w.sim.ledger);
    expect(ledgerKeys.sort()).toEqual(
      ['admin', 'credentials', 'issuedCount', 'issuers', 'nullifiers', 'policies', 'revokedCount', 'verifications'].sort(),
    );
  });
});

describe('simulator', () => {
  it('can read the ledger right after deployment, before any call', async () => {
    const { KolaSimulator } = await import('../sdk/src/index.js');
    const admin = randomBytes32();
    const sim = new KolaSimulator(admin, TODAY);
    expect(eq(sim.ledger.admin, pureCircuits.adminKey(admin))).toBe(true);
    expect(sim.ledger.issuers.size()).toBe(0n);
  });
});
