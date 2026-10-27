// SPDX-License-Identifier: Apache-2.0
// Demo cast (all fictional): issuer Kumba Verify, holders Manka and Ebai, apps Sawa Exchange and Ndole Games.
import {
  KolaSimulator, makeCredential, makePolicy, pureCircuits, dayNumber, minAgeDays,
  randomBytes32, labelBytes32, COUNTRY, type KolaPrivateState,
} from '../sdk/src/index.js';

export const TODAY = dayNumber('2026-11-10');

export function world() {
  const adminSecret = randomBytes32();
  const sim = new KolaSimulator(adminSecret, TODAY);

  const kumba = { secret: randomBytes32() };
  const kumbaPk = pureCircuits.issuerKey(kumba.secret);
  sim.addIssuer(adminSecret, kumbaPk);

  const mankaSecret = randomBytes32();
  const manka = makeCredential(kumba.secret, pureCircuits.holderKey(mankaSecret), {
    dobDay: dayNumber('1998-05-14'), country: COUNTRY.Cameroon, sanctionsClear: true,
    screenedDay: TODAY - 10n, expiryDay: dayNumber('2027-11-10'),
  });
  sim.issueCredential(kumba.secret, manka.leaf);
  const mankaPs: KolaPrivateState = { holderSecret: mankaSecret, credential: manka.credential, salt: manka.salt };

  const ebaiSecret = randomBytes32();
  const ebai = makeCredential(kumba.secret, pureCircuits.holderKey(ebaiSecret), {
    dobDay: dayNumber('2009-03-02'), country: COUNTRY.Cameroon, sanctionsClear: true,
    screenedDay: TODAY - 5n, expiryDay: dayNumber('2027-11-10'),
  });
  sim.issueCredential(kumba.secret, ebai.leaf);
  const ebaiPs: KolaPrivateState = { holderSecret: ebaiSecret, credential: ebai.credential, salt: ebai.salt };

  const sawa = { id: labelBytes32('sawa-exchange'), secret: randomBytes32() };
  sim.setPolicy(sawa.secret, sawa.id, makePolicy(pureCircuits.appKey(sawa.secret), {
    minAgeDays: minAgeDays(18),
    countries: [COUNTRY.Cameroon, COUNTRY.Ghana, COUNTRY.Kenya, COUNTRY.Nigeria],
    requireSanctionsClear: true, maxScreenAgeDays: 90n,
  }));
  const ndole = { id: labelBytes32('ndole-games'), secret: randomBytes32() };
  sim.setPolicy(ndole.secret, ndole.id, makePolicy(pureCircuits.appKey(ndole.secret), { minAgeDays: minAgeDays(18) }));

  return { sim, adminSecret, kumba, kumbaPk, manka, mankaSecret, mankaPs, ebai, ebaiPs, sawa, ndole };
}

/** Issue a fresh credential with chosen attributes; returns the holder's private state. */
export function holderWith(w: ReturnType<typeof world>, attrs: Partial<{
  dobDay: bigint; country: number; sanctionsClear: boolean; screenedDay: bigint; expiryDay: bigint;
}>): KolaPrivateState {
  const secret = randomBytes32();
  const c = makeCredential(w.kumba.secret, pureCircuits.holderKey(secret), {
    dobDay: dayNumber('1990-01-01'), country: COUNTRY.Cameroon, sanctionsClear: true,
    screenedDay: TODAY - 1n, expiryDay: TODAY + 365n, ...attrs,
  });
  w.sim.issueCredential(w.kumba.secret, c.leaf);
  return { holderSecret: secret, credential: c.credential, salt: c.salt };
}
