// SPDX-License-Identifier: Apache-2.0
// Kola ID web demo. Runs the compiled Kola ID Compact circuits in the browser against a local copy
// of the public ledger (the same simulator the test suite uses). Each actor has its own private state.
// UI: the Kola ID consumer design (story hub, wallet, issuer console, registry, apps, beyond finance,
// network, ledger drawer). Every button drives the real simulator; nothing on screen is canned.
import './style.css';
import { icon } from './icons.js';
import {
  KolaSimulator, makeCredential, makePolicy, pureCircuits, randomBytes32, labelBytes32, toHex,
  dayNumber, dayToIso, minAgeDays, COUNTRY, type Credential, type KolaPrivateState, type Policy,
  USE_CASES, UseCaseRegistry, runFailCase, type UseCase,
} from '../../../sdk/src/index.js';
import preprodDeployment from '../../../deploy/preprod-deployment.json';

// ------------------------------------------------------------------ model
const COUNTRY_NAMES: Record<number, string> = {
  [COUNTRY.Cameroon]: 'Cameroon', [COUNTRY.Ghana]: 'Ghana', [COUNTRY.Kenya]: 'Kenya',
  [COUNTRY.Nigeria]: 'Nigeria', [COUNTRY.France]: 'France', [COUNTRY.Iran]: 'Iran',
};
const COUNTRY_CODE: Record<number, string> = {
  [COUNTRY.Cameroon]: 'CM', [COUNTRY.Ghana]: 'GH', [COUNTRY.Kenya]: 'KE',
  [COUNTRY.Nigeria]: 'NG', [COUNTRY.France]: 'FR', [COUNTRY.Iran]: 'IR',
};
const FLAGS: Record<number, [string, string[]]> = {
  [COUNTRY.Cameroon]: ['v', ['#007A5E', '#CE1126', '#FCD116']],
  [COUNTRY.Ghana]: ['h', ['#CE1126', '#FCD116', '#006B3F']],
  [COUNTRY.Kenya]: ['h', ['#111', '#BB0000', '#006600']],
  [COUNTRY.Nigeria]: ['v', ['#008751', '#fff', '#008751']],
  [COUNTRY.France]: ['v', ['#002395', '#fff', '#ED2939']],
  [COUNTRY.Iran]: ['h', ['#239F40', '#fff', '#DA0000']],
};
const EDITOR_COUNTRIES = [COUNTRY.Cameroon, COUNTRY.Ghana, COUNTRY.Kenya, COUNTRY.Nigeria];
const todayDay = dayNumber(new Date().toISOString().slice(0, 10));
const yearsAgo = (y: number, extraDays = 0) => {
  const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y);
  return dayNumber(d.toISOString().slice(0, 10)) + BigInt(extraDays);
};

interface Joined { app: string; nf: string; at: string; kind: 'sign-up' | 'login' }
interface Holder {
  name: string; secret: Uint8Array; credential?: Credential; salt?: Uint8Array; leaf?: Uint8Array; revoked: boolean;
  av: string; facts?: Facts; joined: Joined[]; preset: boolean;
}
interface App { name: string; id: Uint8Array; secret: Uint8Array; seen: { nf: string; at: string; kind: string }[]; av: string; kind: string; draft: Draft }
interface Issuer { name: string; place: string; secret: Uint8Array; status: 'approved' | 'pending' | 'suspended' | 'rejected'; av: string; initials: string }
interface Draft { minAgeYears: number; countries: number[]; sanctions: boolean; maxDays: number }
type Facts = { dobDay: bigint; country: number; sanctionsClear: boolean; screenedDay: bigint; expiryDay: bigint };

let sim: KolaSimulator;
let adminSecret: Uint8Array;
let issuers: Issuer[];
let issuer: Issuer; // Kumba Verify: the issuer used by the guided story
let holders: Holder[];
let apps: App[];
type Tab = 'story' | 'wallet' | 'apps' | 'issuer' | 'registry' | 'beyond' | 'network';
let tab: Tab = 'story';
let currentHolder = 'Manka';
let reqApp = 'Sawa Exchange';
let sheetOpen = false;
interface Outcome { kind: 'success' | 'blocked' | 'denied' | 'proving'; app: string; holder: string; returning: boolean; title: string; text: string; nf?: string; pill?: string; action?: 'login' | 'signup' | 'issuer' }
let outcome: Outcome | null = null;
let lastIssue: { ok: boolean; names: string[]; leaf?: string; root?: string; err?: string; reissue?: boolean } | null = null;
let events: { text: string; kind: 'ok' | 'bad' | 'warn'; at: string }[] = [];
const done = new Set<number>();
let drawerOpen = false;
let moreOpen = false;
let toastMsg: { text: string; bad: boolean; id: number } | null = null;
let timeline: { text: string; kind: 'ok' | 'bad' | ''; at: string }[] = [];

// "Beyond finance" presets: one person (Manka), three registries, three apps.
interface UcState { uc: UseCase; reg: UseCaseRegistry; manka?: KolaPrivateState; leaf?: string; nf?: string; result?: { ok: boolean; text: string }; failText?: string; failOk?: boolean }
let ucs: UcState[] = [];
let mankaUcSecret = randomBytes32();
function resetUseCases() {
  mankaUcSecret = randomBytes32();
  ucs = USE_CASES.map((uc) => ({ uc, reg: new UseCaseRegistry(uc, todayDay) }));
}

const SAWA_POLICY: Draft = { minAgeYears: 18, countries: [COUNTRY.Cameroon, COUNTRY.Ghana, COUNTRY.Kenya, COUNTRY.Nigeria], sanctions: true, maxDays: 90 };
const NDOLE_POLICY: Draft = { minAgeYears: 18, countries: [], sanctions: false, maxDays: 0 };
const MANKA = (): Facts => ({ dobDay: dayNumber('1998-05-14'), country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: todayDay - 10n, expiryDay: todayDay + 365n });
const EBAI = (): Facts => ({ dobDay: yearsAgo(17), country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: todayDay - 5n, expiryDay: todayDay + 365n });

function reset() {
  stopPlay();
  adminSecret = randomBytes32();
  sim = new KolaSimulator(adminSecret, todayDay);
  issuers = [
    { name: 'Kumba Verify', place: 'Douala, Cameroon · licensed KYC company', secret: randomBytes32(), status: 'pending', av: 'av-ink', initials: 'KV' },
    { name: 'Accra TrustCheck', place: 'Accra, Ghana · mobile-money KYC', secret: randomBytes32(), status: 'pending', av: 'av-gold', initials: 'AT' },
    { name: 'Rift KYC', place: 'Nairobi, Kenya · paused for audit', secret: randomBytes32(), status: 'suspended', av: 'av-gray', initials: 'RK' },
  ];
  issuer = issuers[0];
  holders = [
    { name: 'Manka', secret: randomBytes32(), revoked: false, av: 'av-peach', facts: MANKA(), joined: [], preset: true },
    { name: 'Ebai', secret: randomBytes32(), revoked: false, av: 'av-cream', facts: EBAI(), joined: [], preset: true },
  ];
  apps = [
    { name: 'Sawa Exchange', id: labelBytes32('sawa-exchange'), secret: randomBytes32(), seen: [], av: 'av-ink', kind: 'Crypto exchange', draft: { ...SAWA_POLICY } },
    { name: 'Ndole Games', id: labelBytes32('ndole-games'), secret: randomBytes32(), seen: [], av: 'av-gold', kind: 'Games and betting', draft: { ...NDOLE_POLICY } },
  ];
  done.clear(); lastIssue = null; outcome = null; sheetOpen = false; events = []; timeline = [];
  currentHolder = 'Manka'; reqApp = 'Sawa Exchange';
  resetUseCases();
  log('Kola ID contract deployed (local simulator). Admin key hash written to the ledger.', 'ok');
}

// ------------------------------------------------------------------ helpers
const hex = (b: Uint8Array | string) => (typeof b === 'string' ? b : toHex(b));
const short = (b: Uint8Array | string) => { const h = hex(b); return h.slice(0, 4) + '…' + h.slice(-6); };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const fmtDay = (d: bigint) => fmtIso(dayToIso(d));
const rootHex = (s: KolaSimulator) => s.ledger.credentials.root().field.toString(16).padStart(64, '0');
const chip = (h: Uint8Array | string, cls = '') => { const f = hex(h); return `<button class="chip ${cls}" data-act="copy" data-h="${f}" title="Copy ${f}">${short(f)}${icon('copy', 13, 2.2)}</button>`; };
const flag = (c: number, cls = '') => { const f = FLAGS[c]; return f ? `<span class="flag ${f[0]} ${cls}">${f[1].map((x) => `<i style="background:${x}"></i>`).join('')}</span>` : ''; };
const pill = (text: string, cls = '') => `<span class="pill ${cls}">${text}</span>`;
const ageYears = (dob: bigint, today = todayDay) => {
  const [y, m, d] = dayToIso(dob).split('-').map(Number); const [ty, tm, td] = dayToIso(today).split('-').map(Number);
  return ty - y - ((tm < m || (tm === m && td < d)) ? 1 : 0);
};

function log(text: string, kind: 'ok' | 'bad' | '' = '') { timeline.push({ text, kind, at: hm() }); }
function toast(text: string, bad = false) {
  const id = Date.now(); toastMsg = { text, bad, id };
  setTimeout(() => { if (toastMsg?.id === id) { toastMsg = null; drawToast(); } }, 3600);
}

const FRIENDLY: [RegExp, string][] = [
  [/too young/, 'Too young for this app. Nothing else about the age was revealed.'],
  [/already registered/, 'Already registered with this app: one account per person (sybil resistance).'],
  [/not registered/, 'Not registered with this app yet: sign up first.'],
  [/country not allowed/, 'Country not on this app\'s allow-list. The country itself stayed private.'],
  [/screening not clear/, 'Sanctions screening is not clear.'],
  [/screening too old/, 'Sanctions screening is older than this app accepts. Ask the issuer to re-screen.'],
  [/expired/, 'Credential expired. Ask the issuer for a new one.'],
  [/not found in the registry|unknown or revoked/, 'This credential has been revoked (or was never issued).'],
  [/not an approved issuer/, 'Rejected: this issuer is not approved by the registry.'],
  [/not admin/, 'Only the registry admin can do this.'],
  [/not the holder/, 'This credential belongs to someone else.'],
  [/private state has no credential/, 'No credential in this wallet yet. Ask the issuer first.'],
];
const rawMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function friendly(e: unknown): string {
  const msg = rawMsg(e);
  for (const [re, text] of FRIENDLY) if (re.test(msg)) return text;
  return msg;
}

/** Runs one ledger action, logs it, and returns the raw error message if it was refused. */
function attempt(label: string, f: () => string | void): { ok: boolean; err?: string; text: string } {
  try {
    const extra = f();
    const text = `${label}${extra ? '. ' + extra : ''}`;
    log(text, 'ok'); return { ok: true, text };
  } catch (e) {
    const text = `${label}: ${friendly(e)}`;
    log(text, 'bad'); return { ok: false, err: rawMsg(e), text };
  }
}

function holderPs(h: Holder): KolaPrivateState {
  return { holderSecret: h.secret, credential: h.credential, salt: h.salt };
}

// ------------------------------------------------------------------ actions (real simulator calls)
function approveIssuer(i: Issuer = issuer) {
  const r = attempt(`Admin approves ${i.name}`, () => { sim.addIssuer(adminSecret, pureCircuits.issuerKey(i.secret)); i.status = 'approved'; });
  toast(r.ok ? `${i.name} approved. Its key hash is now on the ledger.` : r.text, !r.ok); return r;
}
function removeIssuer(i: Issuer = issuer) {
  const r = attempt(`Admin suspends ${i.name}`, () => { sim.removeIssuer(adminSecret, pureCircuits.issuerKey(i.secret)); i.status = 'suspended'; });
  toast(r.ok ? `${i.name} suspended. It can no longer issue credentials.` : r.text, !r.ok); return r;
}
function rejectIssuer(i: Issuer) {
  i.status = 'rejected'; log(`Admin rejects ${i.name}'s application (nothing written on-chain)`, '');
  toast(`${i.name}'s application rejected. Nothing was written on-chain.`);
}
function issue(h: Holder, a: Facts, by: Issuer = issuer) {
  const wasRevoked = h.revoked;
  const r = attempt(`${by.name} issues a credential to ${h.name}`, () => {
    const c = makeCredential(by.secret, pureCircuits.holderKey(h.secret), a);
    sim.issueCredential(by.secret, c.leaf);
    Object.assign(h, { credential: c.credential, salt: c.salt, leaf: c.leaf, revoked: false, facts: a });
    return `Only the commitment ${short(c.leaf)} went on-chain`;
  });
  if (r.ok) {
    if (wasRevoked) events.push({ text: `Re-issued a fresh credential to ${h.name}`, kind: 'ok', at: hm() });
    toast(`${h.name}'s credential issued. Only a commitment went on-chain.`);
  } else toast(r.text, true);
  return r;
}
function revoke(h: Holder) {
  const r = attempt(`${issuer.name} revokes ${h.name}'s credential`, () => {
    sim.revokeCredential(issuer.secret, h.credential!, h.salt!); h.revoked = true;
    return 'Slot zeroed and root history reset; no app record can be linked to it';
  });
  if (r.ok) { events.push({ text: `Revoked ${h.name}'s credential`, kind: 'bad', at: hm() }); toast(`${h.name}'s credential revoked. Apps will refuse it from now on.`); }
  else toast(r.text, true);
  return r;
}
function savePolicy(app: App, p: Draft & { epoch?: bigint }) {
  const r = attempt(`${app.name} publishes its policy`, () => {
    const epoch = p.epoch ?? (sim.ledger.policies.member(app.id) ? sim.ledger.policies.lookup(app.id).epoch : 0n);
    sim.setPolicy(app.secret, app.id, makePolicy(pureCircuits.appKey(app.secret), {
      minAgeDays: minAgeDays(p.minAgeYears), countries: p.countries,
      requireSanctionsClear: p.sanctions, maxScreenAgeDays: BigInt(p.maxDays), epoch,
    }));
  });
  if (r.ok) { app.draft = draftOf(app); toast(`${app.name}'s rules are published on the ledger.`); } else toast(r.text, true);
  return r;
}
function bumpEpoch(app: App) {
  const r = attempt(`${app.name} opens a new sign-up epoch`, () => {
    const p = sim.ledger.policies.lookup(app.id);
    sim.setPolicy(app.secret, app.id, { ...p, epoch: p.epoch + 1n });
  });
  toast(r.ok ? `${app.name} opened a new epoch: everyone gets a fresh anonymous ID.` : r.text, !r.ok); return r;
}
function prove(h: Holder, app: App, returning = false) {
  let nf = '';
  const r = attempt(`${h.name} ${returning ? 'logs in to' : 'signs up to'} ${app.name} with Kola ID`, () => {
    const n = returning ? sim.proveReturning(holderPs(h), app.id, todayDay) : sim.proveForApp(holderPs(h), app.id, todayDay);
    nf = toHex(n);
    app.seen.unshift({ nf, at: hm(), kind: returning ? 'login' : 'sign-up' });
    h.joined = [{ app: app.name, nf, at: hm(), kind: returning ? 'login' : 'sign-up' }, ...h.joined.filter((j) => j.app !== app.name)];
    return `${app.name} received only the nullifier ${short(n)}`;
  });
  return { ...r, nf };
}

function ucIssue(u: UcState) {
  if (u.manka) return;
  try {
    u.manka = u.reg.issue(mankaUcSecret, u.uc.manka(todayDay));
    u.leaf = toHex(pureCircuits.credentialLeaf(u.manka.credential!, u.manka.salt!));
    u.result = { ok: true, text: `${u.uc.issuer} issued Manka a credential. Only the commitment ${short(u.leaf)} went on-chain.` };
    log(`${u.uc.registry.name}: ${u.uc.issuer} issues to Manka`, 'ok');
  } catch (e) { u.result = { ok: false, text: friendly(e) }; log(u.result.text, 'bad'); }
}
function ucProve(u: UcState) {
  ucIssue(u);
  try {
    const nf = u.reg.prove(u.manka!);
    u.nf = toHex(nf);
    u.result = { ok: true, text: `Manka passes the ${u.uc.app.name} check. ${u.uc.app.name} received only the nullifier ${short(nf)}.` };
    log(`Manka → ${u.uc.app.name}: passed`, 'ok');
  } catch (e) {
    u.result = { ok: false, text: `Manka → ${u.uc.app.name}: ${friendly(e)}` }; log(u.result.text, 'bad');
  }
}
function ucFail(u: UcState) {
  let msg: string;
  try { msg = runFailCase(u.reg); } catch (e) { msg = `unexpected: ${rawMsg(e)}`; }
  u.failOk = u.uc.fail.expect.test(msg);
  u.failText = u.failOk ? `${u.uc.fail.who} → ${u.uc.app.name}: ${u.uc.fail.outcome}` : `${u.uc.fail.who} → ${u.uc.app.name}: ${friendly(new Error(msg))}`;
  log(u.failText, 'bad');
}
function ucRunAll() {
  resetUseCases();
  ucs.forEach((u) => { ucIssue(u); ucProve(u); ucFail(u); });
}

const byName = (n: string) => holders.find((h) => h.name === n)!;
const app = (n: string) => apps.find((a) => a.name === n)!;
const policyOf = (a: App): Policy | null => (sim.ledger.policies.member(a.id) ? sim.ledger.policies.lookup(a.id) : null);
const verifs = (a: App) => (sim.ledger.verifications.member(a.id) ? sim.ledger.verifications.lookup(a.id).read() : 0n);
const yearsOf = (p: Policy) => (p.minAgeDays === 0n ? 0 : Math.round(Number(p.minAgeDays) / 365.25));
function draftOf(a: App): Draft {
  const p = policyOf(a); if (!p) return { ...a.draft };
  return { minAgeYears: yearsOf(p), countries: p.countries.filter((c) => c !== 0n).map(Number), sanctions: p.requireSanctionsClear, maxDays: p.requireSanctionsClear ? Number(p.maxScreenAgeDays) : 0 };
}
const sameDraft = (x: Draft, y: Draft) => x.minAgeYears === y.minAgeYears && x.maxDays === y.maxDays && x.sanctions === y.sanctions
  && [...x.countries].sort().join() === [...y.countries].sort().join();

// ------------------------------------------------------------------ proof outcomes
function classify(err: string, h: Holder, a: App, returning: boolean): Outcome {
  const p = policyOf(a);
  const base = { app: a.name, holder: h.name, returning };
  if (/already registered/.test(err)) return { ...base, kind: 'blocked', title: 'Already joined', text: `This anonymous ID already has a ${a.name} account, so no second account was made. One person, one account.`, pill: 'One account per person', action: 'login' };
  if (/not registered/.test(err)) return { ...base, kind: 'blocked', title: 'Not a member yet', text: `${h.name} hasn't signed up to ${a.name} with this credential yet. Sign up first.`, action: 'signup' };
  const no = (pillText: string, text: string): Outcome => ({ ...base, kind: 'denied', title: 'Not eligible', text, pill: pillText });
  const yrs = p ? yearsOf(p) : 18;
  if (/too young/.test(err)) return no(`Age ${yrs}+ · not met`, `${a.name} asks for ${yrs}+. ${h.name}'s credential doesn't meet it, so no proof was made and nothing was sent. The app never learns the real age.`);
  if (/country not allowed/.test(err)) return no('Country · not allowed', `${a.name} only accepts some countries. ${h.name}'s country isn't one of them, and it stayed private.`);
  if (/screening/.test(err)) return no('Screening · not met', `${a.name} needs a recent, clear sanctions check. Ask ${issuer.name} to re-screen.`);
  if (/expired/.test(err)) return no('Credential expired', `This credential has expired. Ask ${issuer.name} for a new one.`);
  if (/not found in the registry|unknown or revoked/.test(err)) return { ...base, kind: 'denied', title: 'Credential revoked', text: `${issuer.name} revoked this credential, so the proof fails. ${a.name} learned nothing about who tried.`, pill: 'Revoked by issuer', action: 'issuer' };
  if (/no credential/.test(err)) return { ...base, kind: 'denied', title: 'No credential yet', text: `${h.name}'s wallet is empty. Ask ${issuer.name} to issue a credential first.`, pill: 'No credential', action: 'issuer' };
  return no('Refused', friendly(new Error(err)));
}
function successOutcome(h: Holder, a: App, nf: string, returning: boolean): Outcome {
  return returning
    ? { kind: 'success', app: a.name, holder: h.name, returning, nf, title: 'Welcome back', text: `${h.name} is logged in to ${a.name}. The app recognised the same anonymous ID, and nothing else.` }
    : { kind: 'success', app: a.name, holder: h.name, returning, nf, title: 'You\'re in', text: `${a.name} knows ${h.name} meets its rules. It got a yes and this anonymous ID, nothing more.` };
}
/** Prove from the wallet and record the outcome card. */
function walletProve(hn: string, an: string, returning = false) {
  const h = byName(hn); const a = app(an);
  const r = prove(h, a, returning);
  outcome = r.ok ? successOutcome(h, a, r.nf, returning) : classify(r.err ?? '', h, a, returning);
  return r;
}

// ------------------------------------------------------------------ the guided story
const STEPS: { title: string; tab: Tab; pill?: [string, string]; run: () => void }[] = [
  { title: 'Approve issuer', tab: 'registry', run: () => { approveIssuer(); } },
  { title: 'Issue credentials', tab: 'issuer', run: () => {
    const m = issue(byName('Manka'), MANKA()); const e = issue(byName('Ebai'), EBAI());
    lastIssue = { ok: m.ok && e.ok, names: ['Manka', 'Ebai'], leaf: byName('Ebai').leaf && toHex(byName('Ebai').leaf!), root: rootHex(sim), err: m.err ?? e.err };
    toast('Manka and Ebai each got a credential. Only commitments went on-chain.');
  } },
  { title: 'Apps publish rules', tab: 'apps', run: () => { savePolicy(app('Sawa Exchange'), SAWA_POLICY); savePolicy(app('Ndole Games'), NDOLE_POLICY); toast('Sawa Exchange and Ndole Games published their rules.'); } },
  { title: 'Manka joins Sawa Exchange', tab: 'wallet', run: () => { currentHolder = 'Manka'; reqApp = 'Sawa Exchange'; walletProve('Manka', 'Sawa Exchange'); } },
  { title: 'Manka tries again', tab: 'wallet', pill: ['Already joined', ''], run: () => { currentHolder = 'Manka'; reqApp = 'Sawa Exchange'; walletProve('Manka', 'Sawa Exchange'); } },
  { title: 'Manka joins Ndole Games', tab: 'wallet', run: () => { currentHolder = 'Manka'; reqApp = 'Ndole Games'; walletProve('Manka', 'Ndole Games'); } },
  { title: 'Ebai is too young', tab: 'wallet', pill: ['Denied', 'bad'], run: () => { currentHolder = 'Ebai'; reqApp = 'Sawa Exchange'; walletProve('Ebai', 'Sawa Exchange'); } },
  { title: 'Revoke and re-issue', tab: 'issuer', run: () => {
    currentHolder = 'Manka'; reqApp = 'Sawa Exchange'; const m = byName('Manka'); const sawa = app('Sawa Exchange');
    revoke(m);
    const refused = prove(m, sawa, true);
    events.push(refused.ok ? { text: 'Login after revocation unexpectedly passed', kind: 'bad', at: hm() } : { text: 'Sawa Exchange refused Manka\'s login: credential revoked', kind: 'warn', at: hm() });
    issue(m, MANKA());
    const back = prove(m, sawa, true);
    if (back.ok) events.push({ text: 'Manka logged back in to Sawa Exchange', kind: 'ok', at: hm() });
    outcome = back.ok ? successOutcome(m, sawa, back.nf, true) : classify(back.err ?? '', m, sawa, true);
    lastIssue = { ok: true, names: ['Manka'], leaf: toHex(m.leaf!), root: rootHex(sim), reissue: true };
    toast(back.ok ? 'Revoked, refused, re-issued, and Manka is back in. Same anonymous ID at Sawa.' : 'Re-issue step did not complete.', !back.ok);
  } },
];
const currentStep = () => { for (let i = 0; i < STEPS.length; i++) if (!done.has(i)) return i; return STEPS.length; };
function runStep(i: number) {
  if (done.has(i)) return;
  STEPS[i].run(); done.add(i);
  tab = STEPS[i].tab; sheetOpen = false;
  if (STEPS[i].tab !== 'wallet' && i !== 7) outcome = null;
}
function runUpTo(i: number) { for (let k = 0; k <= i; k++) if (!done.has(k)) runStep(k); tab = STEPS[i].tab; }

let playing = false; let playTimer: ReturnType<typeof setTimeout> | undefined;
const STEP_MS = 9000;
function stopPlay() { playing = false; if (playTimer) clearTimeout(playTimer); playTimer = undefined; }
function playNext() {
  const i = currentStep();
  if (i >= STEPS.length) { stopPlay(); toast('That\'s the whole story. Explore any tab, or open the ledger.'); render(); return; }
  runStep(i); render(); scrollTo({ top: 0 });
  playTimer = setTimeout(currentStep() >= STEPS.length ? () => { stopPlay(); render(); } : playNext, STEP_MS);
}
function startPlay() {
  if (currentStep() >= STEPS.length) reset();
  playing = true; playNext();
}

// ------------------------------------------------------------------ rendering: shell
const TABS: { id: Tab; label: string }[] = [
  { id: 'story', label: 'Story' }, { id: 'wallet', label: 'Wallet' }, { id: 'apps', label: 'Apps' }, { id: 'issuer', label: 'Issuer' },
  { id: 'registry', label: 'Registry' }, { id: 'beyond', label: 'Beyond finance' }, { id: 'network', label: 'Network' },
];
const root = document.getElementById('app')!;

function shell(body: string) {
  const bn = (id: string, label: string, ic: string, on: boolean, act = 'tab') =>
    `<button class="${on ? 'on' : ''}" data-act="${act}" data-tab="${id}"><span class="bi">${icon(ic, 20, 2.2)}</span>${label}</button>`;
  const moreOn = ['story', 'registry', 'beyond', 'network'].includes(tab);
  const moreItems: [Tab, string, string][] = [['story', 'The story', 'play'], ['registry', 'Registry', 'shield'], ['beyond', 'Beyond finance', 'layers'], ['network', 'Network', 'radio']];
  return `
  <header class="topbar">
    <button class="brand" data-act="tab" data-tab="story" aria-label="Kola ID home"><span class="logo">K</span><b>Kola ID</b></button>
    <nav class="nav" aria-label="Sections">${TABS.map((t) => `<button class="${t.id === tab ? 'on' : ''}" data-act="tab" data-tab="${t.id}">${t.label}</button>`).join('')}</nav>
    <span class="spacer"></span>
    <button class="live-pill" data-act="tab" data-tab="network" title="Reference deployment on Midnight Preprod"><span class="dot"></span>Live on Preprod</button>
    <button class="btn-sec" data-act="ledger" style="height:42px">${icon('ledger', 18, 2.2)}Ledger</button>
  </header>
  <header class="m-top">
    <span class="logo">K</span><b>Kola ID</b><span class="spacer"></span>
    <button class="live-pill" data-act="tab" data-tab="network"><span class="dot"></span>Live on Preprod</button>
  </header>
  <main class="main" id="main">${body}</main>
  <footer class="footer">Kola ID · Apache-2.0 · Built on <a href="https://midnight.network" target="_blank" rel="noopener">Midnight</a> by Mbanya Dev · all names in this demo are fictional · <a href="https://github.com/mbanyadev/kola-id" target="_blank" rel="noopener">source</a></footer>
  <nav class="bnav" aria-label="Sections">
    ${bn('wallet', 'Wallet', 'wallet', tab === 'wallet' && !moreOpen && !drawerOpen)}${bn('apps', 'Apps', 'grid', tab === 'apps' && !moreOpen && !drawerOpen)}${bn('issuer', 'Issuer', 'building', tab === 'issuer' && !moreOpen && !drawerOpen)}
    ${bn('ledger', 'Ledger', 'ledger', drawerOpen, 'ledger')}${bn('more', 'More', 'more', (moreOn && !drawerOpen) || moreOpen, 'more')}
  </nav>
  ${moreOpen ? '<div class="scrim" data-act="closeMore"></div>' : ''}
  <div class="more-sheet ${moreOpen ? 'open' : ''}" role="menu">
    <div class="grab"></div>
    ${moreItems.map(([t, l, ic]) => `<button class="mi ${tab === t ? 'on' : ''}" data-act="tab" data-tab="${t}">${icon(ic, 20, 2.2)}${l}</button>`).join('')}
    <button class="mi" data-act="reset">${icon('rotate', 20, 2.2)}Reset demo</button>
  </div>
  ${drawerOpen ? ledgerDrawer() : ''}
  ${playing ? playerBar() : ''}
  <div class="toast-wrap" id="toasts"></div>`;
}

let drawnToast: unknown = null;
function drawToast() {
  const w = document.getElementById('toasts'); if (!w) return;
  const seen = toastMsg === drawnToast; drawnToast = toastMsg;
  w.innerHTML = toastMsg && !playing ? `<div class="toast ${toastMsg.bad ? 'bad' : ''} ${seen ? 'seen' : ''}" role="status"><span class="tdot"></span>${esc(toastMsg.text)}</div>` : '';
}

function playerBar() {
  const i = Math.max(Math.min(currentStep(), STEPS.length) - 1, 0); const s = STEPS[i];
  return `<div class="player" role="region" aria-label="Story player">
    <span class="pn">STEP ${i + 1} / ${STEPS.length}</span><span class="pt">${esc(s.title)}</span>
    <span class="pb"><i style="width:${((i + 1) / STEPS.length) * 100}%"></i></span>
    <button data-act="pause">${icon('pause', 14)}Pause</button>
    ${currentStep() < STEPS.length ? `<button class="pri" data-act="next">Next${icon('arrowRight', 15, 2.4)}</button>` : `<button class="pri" data-act="pause">Done${icon('check', 15, 2.6)}</button>`}
  </div>`;
}

// ------------------------------------------------------------------ hub
function hub() {
  const cur = currentStep();
  const node = (i: number) => {
    const st = done.has(i) ? 'done' : i === cur ? 'current' : 'next';
    const s = STEPS[i];
    const label = st === 'done' ? 'Done' : st === 'current' ? (cur === 0 ? 'Start here' : 'Now') : 'Up next';
    return `<li style="display:contents"><button class="step" data-act="step" data-step="${i}" data-state="${st}" aria-label="Step ${i + 1}: ${esc(s.title)}">
      <span class="node ${st}">${st === 'done' ? icon('check', 20, 3) : i + 1}</span>
      <span class="st">${esc(s.title)}</span>
      <span class="ss ${st}">${label}</span>
      ${s.pill ? pill(s.pill[0], s.pill[1]) : ''}
    </button></li>`;
  };
  const pct = Math.max(0, Math.min(1, cur / (STEPS.length - 1))) * 100;
  const steps3: [string, string, string, string][] = [
    ['userCheck', 'STEP 1', 'Verified once', `${issuer.name}, a licensed KYC company, checks her ID one time.`],
    ['phone', 'STEP 2', 'Proof on her phone', 'A private credential lands in her Kola ID wallet.'],
    ['shield', 'STEP 3', 'Apps learn only yes or no', 'Plus an anonymous ID that is different for every app.'],
  ];
  return `<section class="page hub" data-screen="story">
    <div class="hero">
      <div class="hero-l">
        <span class="status-pill"><span class="dot"></span>Running in your browser · Live on Midnight Preprod</span>
        <h1>Verify once.<br class="d"> Prove anywhere.<br><span class="grad-text">Stay unlinkable.</span></h1>
        <p class="hero-lede">Reusable private identity proofs on Midnight for the apps that onboard Africa: mobile money, exchanges, lenders, co-ops and hiring.</p>
        <div class="hero-cta">
          <button class="btn-play" data-act="play"><span class="pc">${icon(playing ? 'pause' : 'play', 20)}</span>${playing ? 'Pause the story' : cur >= STEPS.length ? 'Replay the 2-minute story' : cur > 0 ? 'Continue the story' : 'Play the 2-minute story'}</button>
          <button class="btn-sec" data-act="tab" data-tab="wallet">${icon('compass', 20, 2.2)}Explore on my own</button>
        </div>
      </div>
      <div class="explainer">
        <span class="bubble" style="width:260px;height:260px;right:-80px;top:-90px;background:rgba(255,255,255,.12)"></span>
        <span class="bubble" style="width:180px;height:180px;left:-60px;bottom:-70px;background:rgba(255,200,87,.25)"></span>
        ${steps3.map(([ic, n, b, t]) => `<div class="ex-step"><span class="ic-circle">${icon(ic, 22, 2.2)}</span><div><small>${n}</small><b>${b}</b><span class="t">${t}</span></div></div>`).join('')}
      </div>
    </div>
    <div class="card story">
      <div class="story-head"><b>The story</b>${pill(cur >= STEPS.length ? 'All 8 steps done' : `Step ${cur + 1} of ${STEPS.length}`, cur >= STEPS.length ? 'ok' : '')}<span class="spacer"></span><span class="muted">Plays in about 2 minutes · tap any step to jump</span></div>
      <div class="track"><div class="track-line"><i style="width:${pct}%"></i></div>
        <ol class="steps" id="steps">${STEPS.map((_, i) => node(i)).join('')}</ol></div>
      <div class="story-foot">
        <span class="muted">Every step runs the real Kola ID circuits against a local copy of the ledger.</span><span class="spacer"></span>
        ${cur < STEPS.length ? `<button class="btn-ghost" data-act="skip" id="runAll">${icon('skip', 16)}Skip to the end</button>` : ''}
        <button class="btn-ghost" data-act="reset" id="reset">${icon('rotate', 16, 2.2)}Start over</button>
      </div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ wallet
function factsOf(h: Holder): Facts | null {
  return h.credential ? { dobDay: h.credential.dobDay, country: Number(h.credential.country), sanctionsClear: h.credential.sanctionsClear, screenedDay: h.credential.screenedDay, expiryDay: h.credential.expiryDay } : null;
}

function passCard(h: Holder) {
  const f = factsOf(h);
  if (!f) {
    return `<div class="pass-empty dashed" data-pass="empty"><span class="ic-circle">${icon('inbox', 22, 2.2)}</span><div style="flex:1"><b>No Kola ID yet</b><span class="t">${esc(h.name)}'s wallet is empty. ${issuer.name} issues a credential after a normal ID check.</span></div>
      <button class="btn sm" data-act="tab" data-tab="issuer">Go to issuer</button></div>`;
  }
  return `<div class="pass" data-pass="${h.revoked ? 'revoked' : 'active'}">
    <div class="pass-top ${h.revoked ? 'revoked' : ''}">
      <span class="bubble" style="width:200px;height:200px;right:-60px;top:-80px;background:rgba(255,255,255,.14)"></span>
      <span class="bubble" style="width:120px;height:120px;right:40px;bottom:-70px;background:rgba(255,255,255,.12)"></span>
      <div class="pass-row"><span class="pass-k">K</span><span class="iss"><small>Issued by</small><b>${issuer.name}</b></span>
        <span class="pass-status ${h.revoked ? 'bad' : ''}"><span class="dot"></span>${h.revoked ? 'Revoked' : 'Active'}</span></div>
      <div class="pass-holder"><small>Holder</small><b>${esc(h.name)}</b></div>
    </div>
    <div class="pass-body">
      <div class="facts">
        <div class="fact"><small>BORN</small><b>${dayToIso(f.dobDay)}</b><span>${ageYears(f.dobDay)} years old</span></div>
        <div class="fact"><small>COUNTRY</small><b>${flag(f.country)}${COUNTRY_NAMES[f.country] ?? f.country}</b></div>
        <div class="fact"><small>SANCTIONS</small><b style="color:${f.sanctionsClear ? 'var(--k-success)' : 'var(--k-danger)'}">${f.sanctionsClear ? 'Clear' : 'Match'}</b><span>Screened ${fmtDay(f.screenedDay)}</span></div>
      </div>
      <div class="pass-foot">${pill(`${icon('lock', 13, 2.4)}Private · stays on this device`)}<span class="exp">Expires ${fmtDay(f.expiryDay)}</span></div>
    </div>
  </div>`;
}

interface Row { ic: string; title: string; sub: string; ok: boolean | null }
function checkRows(h: Holder, p: Policy): Row[] {
  const f = factsOf(h); const rows: Row[] = [];
  const yrs = yearsOf(p);
  if (yrs > 0) rows.push({ ic: 'cake', title: `Age ${yrs}+`, sub: 'From your birth date', ok: f ? todayDay - f.dobDay >= p.minAgeDays : null });
  const cs = p.countries.filter((c) => c !== 0n).map(Number);
  if (cs.length) rows.push({ ic: 'globe', title: `Country in ${cs.map((c) => COUNTRY_CODE[c] ?? c).join(', ').replace(/, ([^,]*)$/, ' or $1')}`, sub: 'From your country', ok: f ? cs.includes(f.country) : null });
  if (p.requireSanctionsClear) rows.push({ ic: 'search', title: `Screened within ${p.maxScreenAgeDays} days`, sub: 'Sanctions check by your issuer', ok: f ? f.sanctionsClear && todayDay - f.screenedDay <= p.maxScreenAgeDays : null });
  if (f) rows.push({ ic: 'shield', title: 'Credential valid', sub: h.revoked ? 'Revoked by your issuer' : `Until ${fmtDay(f.expiryDay)}`, ok: !h.revoked && f.expiryDay > todayDay });
  return rows;
}

function requestSheet(h: Holder, a: App) {
  const p = policyOf(a);
  const head = `<div class="sheet-grab"></div><div class="sheet-head"><span class="avatar ${a.av}">${a.name[0]}</span><div><small>Sign in with Kola ID</small><b>${a.name} wants to check</b></div>
    <button class="icon-btn x" data-act="closeSheet" aria-label="Close">${icon('x', 18)}</button></div>`;
  if (!p) {
    return `<div class="sheet" data-sheet="${esc(a.name)}">${head}
      <div class="dashed"><span class="ic-circle">${icon('inbox', 22, 2.2)}</span><div><b>${a.name} hasn't published its rules yet</b><span class="t">An app must put its policy on the ledger before anyone can prove against it.</span></div></div>
      <button class="btn lg block" data-act="tab" data-tab="apps">Open Apps to publish</button></div>`;
  }
  const rows = checkRows(h, p);
  const hasCred = !!h.credential;
  const allOk = hasCred && rows.every((r) => r.ok);
  const proving = outcome?.kind === 'proving';
  const warn = !hasCred ? `No credential in ${h.name}'s wallet yet.` : h.revoked ? `${issuer.name} revoked this credential.` : '';
  const qual = (r: Row) => r.ok === null ? '<span class="qual" style="color:var(--k-muted)">—</span>'
    : r.ok ? `<span class="qual">${icon('check', 14, 3)}You qualify</span>` : `<span class="qual no">${icon('x', 14, 3)}Not met</span>`;
  return `<div class="sheet" data-sheet="${esc(a.name)}">${head}
    <div class="checks">${rows.map((r) => `<div class="check"><span class="ic-circle bg">${icon(r.ic, 20, 2.2)}</span><div class="ct"><b>${r.title}</b><span>${r.sub}</span></div>${qual(r)}</div>`).join('')
      || `<div class="check"><span class="ic-circle bg">${icon('shield', 20, 2.2)}</span><div class="ct"><b>A valid Kola ID</b><span>No other rules</span></div></div>`}</div>
    <div class="learns"><span class="ic-circle">${icon('eye', 20, 2.2)}</span><div><small>What ${a.name} learns</small><b>Only: yes + an anonymous ID for this app</b><span>Never your name, birth date, document or country.</span></div></div>
    ${warn ? `<div class="sheet-warn">${icon('ban', 18, 2.4)}${warn}</div>` : ''}
    <div class="sheet-actions">
      ${proving ? `<div class="proving"><span class="spin" style="width:20px;height:20px"></span>Making the proof on this device…</div>`
        : allOk ? `<button class="btn lg block" data-act="prove">${icon('shield', 20, 2.2)}Approve and prove</button>`
        : `<button class="btn-disabled" disabled>${hasCred ? 'You don\'t meet this app\'s rules' : 'No credential yet'}</button>
           <button class="btn-ghost" data-act="prove" style="align-self:center">Try anyway and watch the proof refuse</button>`}
      <div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap">
        <button class="btn-ghost" data-act="closeSheet">Not now</button>
        <button class="btn-ghost" data-act="login">${icon('logIn', 16, 2.2)}Already joined? Log in</button>
      </div>
    </div>
    <div class="sheet-note">${icon('lock', 14, 2.4)}The proof is made on your phone. Your data never leaves it.</div>
  </div>`;
}

function outcomeCard(o: Outcome) {
  const big = o.kind === 'success' ? `<div class="big-ic ok"><i>${icon('check', 46, 3)}</i></div>`
    : o.kind === 'blocked' ? `<div class="big-ic blocked"><i>${icon('userCheck', 40, 2.4)}</i></div>`
    : `<div class="big-ic bad"><i>${icon(o.title === 'Credential revoked' ? 'ban' : 'x', 44, 3)}</i></div>`;
  const acts: string[] = [];
  if (o.kind === 'success') acts.push(`<button class="btn lg block" data-act="closeOutcome">Continue to ${esc(o.app)}${icon('arrowRight', 18, 2.4)}</button>`);
  if (o.action === 'login') acts.push(`<button class="btn lg block" data-act="login">${icon('logIn', 18, 2.4)}Log in instead</button>`);
  if (o.action === 'signup') acts.push('<button class="btn lg block" data-act="prove">Sign up instead</button>');
  if (o.action === 'issuer') acts.push('<button class="btn-sec lg block" data-act="tab" data-tab="issuer">Open the issuer console</button>');
  acts.push('<button class="btn-ghost" data-act="closeOutcome">Back to wallet</button>');
  return `<div class="outcome" data-outcome="${o.kind}" data-title="${esc(o.title)}">
    ${big}
    <h3>${esc(o.title)}</h3>
    <p>${esc(o.text)}</p>
    ${o.pill ? pill(esc(o.pill), o.kind === 'denied' ? 'bad' : '') : ''}
    ${o.nf ? `<span class="nfl">${o.returning ? 'Same anonymous ID as before' : `Your anonymous ID at ${esc(o.app)}`}</span>${chip(o.nf)}` : ''}
    ${o.kind === 'denied' ? `<span class="nfl">${esc(o.app)} learned nothing: not the age, not the name.</span>` : ''}
    <div class="oacts">${acts.join('')}</div>
  </div>`;
}

function wallet() {
  const h = byName(currentHolder) ?? holders[0];
  const a = app(reqApp);
  const showOutcome = outcome && outcome.kind !== 'proving';
  const right = showOutcome ? outcomeCard(outcome!) : `
      <div class="req-tabs"><span class="lbl">Request from</span><div class="seg">${apps.map((x) => `<button class="${x.name === reqApp ? 'on' : ''}" data-act="reqApp" data-app="${x.name}"><span class="mini avatar ${x.av}">${x.name[0]}</span>${x.name}</button>`).join('')}</div></div>
      ${requestSheet(h, a)}`;
  const joined = h.joined;
  return `<section class="wallet" data-screen="wallet">
    <div class="wallet-l">
      <div class="hello"><div><span class="hi">Hi ${esc(h.name)}</span><h2>Your Kola ID</h2></div>
        <div class="seg" role="tablist" aria-label="Whose wallet">${holders.map((x) => `<button class="${x.name === h.name ? 'on' : ''}" data-act="holder" data-holder="${esc(x.name)}"><span class="mini avatar ${x.av}">${esc(x.name.slice(0, 2).toUpperCase())}</span>${esc(x.name)}</button>`).join('')}</div></div>
      ${passCard(h)}
      <div class="m-req card pad" style="flex-direction:column;gap:6px">
        <b style="font-weight:800;font-size:16px">Sign-in requests</b>
        ${apps.map((x) => `<div class="app-row" style="box-shadow:none;padding:6px 0"><span class="avatar ${x.av}">${x.name[0]}</span><span class="meta"><b>${x.name}</b><span>${policyOf(x) ? 'Wants to check your Kola ID' : 'Rules not published yet'}</span></span>
          <button class="btn sm" data-act="review" data-app="${x.name}">Review</button></div>`).join('')}
      </div>
      <div class="signed"><b>Where you've signed in</b>
        ${joined.length ? joined.map((j) => { const x = app(j.app); return `<div class="app-row"><span class="avatar ${x.av}">${x.name[0]}</span><span class="meta"><b>${x.name}</b><span>${j.kind === 'login' ? 'Logged in' : 'Signed up'} · today ${j.at}</span></span>${chip(j.nf, 'white')}</div>`; }).join('')
          + (joined.length > 1 ? '<span class="muted" style="font-size:13px">A different anonymous ID at every app, so they can\'t compare notes.</span>' : '')
        : `<div class="dashed"><span class="ic-circle">${icon('inbox', 20, 2.2)}</span><div><b>No apps yet</b><span class="t">Each app you join gets its own anonymous ID, so they can't compare notes.</span></div></div>`}
      </div>
    </div>
    <div class="wallet-r ${sheetOpen || outcome ? 'open' : ''} ${showOutcome ? 'outcome-open' : ''}">
      <span class="bubble" style="width:240px;height:240px;right:-50px;top:30px;background:rgba(255,200,87,.25)"></span>
      ${right}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ issuer
function issuerPage() {
  const st = issuer.status;
  const person = (h: Holder) => {
    const f = h.facts ?? factsOf(h);
    const tags = f ? [`${flag(f.country, 'sm')}${COUNTRY_NAMES[f.country] ?? f.country}`, `Born ${dayToIso(f.dobDay)}`, `${ageYears(f.dobDay)} years`] : [];
    const action = !h.credential
      ? `<button class="btn sm" data-act="issue" data-holder="${esc(h.name)}">${icon('phone', 16, 2.2)}Issue credential</button><span class="muted">Documents checked ${fmtDay(todayDay - 1n)}</span>`
      : h.revoked
        ? `${pill('Revoked', 'bad')}<button class="btn sm" data-act="issue" data-holder="${esc(h.name)}">${icon('rotate', 16, 2.2)}Re-issue</button>`
        : `${pill(`${icon('check', 13, 3)}Issued`, 'ok')}<button class="btn-ghost danger" data-act="revoke" data-holder="${esc(h.name)}" style="height:34px">${icon('ban', 15, 2.2)}Revoke</button>`;
    return `<div class="card person" data-person="${esc(h.name)}"><span class="avatar ${h.av}">${esc(h.name.slice(0, 2).toUpperCase())}</span>
      <div class="pm"><b>${esc(h.name)}</b><div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div></div>
      <div class="pa">${action}</div></div>`;
  };
  const opt = (v: string | number, l: string) => `<option value="${v}">${l}</option>`;
  const li = lastIssue;
  const result = li ? (li.ok ? `<div class="card result-card" data-result="ok">
      <div class="rc-head"><span class="tick">${icon('check', 24, 3)}</span><div><b>${li.reissue ? `${li.names[0]}'s credential re-issued` : `${li.names.join(' and ')}'s credential${li.names.length > 1 ? 's are' : ' is'} issued`}</b><span>Sent to ${li.names.length > 1 ? 'their phones' : 'the phone'}. Here is what the world can see.</span></div></div>
      <div class="eyebrow gray">ON-CHAIN · PUBLIC</div>
      <div class="onchain">
        <div class="kv"><span>${li.names.length > 1 ? 'Latest commitment' : 'Commitment'}</span>${li.leaf ? chip(li.leaf, 'white') : ''}</div>
        <div class="kv"><span>Merkle root</span>${chip(rootHex(sim), 'white')}</div>
        <div class="kv"><span>Issued count</span><span class="v">${sim.ledger.issuedCount}</span></div>
        <div class="kv"><span>Revoked count</span><span class="v">${sim.ledger.revokedCount}</span></div>
      </div>
      <div class="eyebrow gray">OFF-CHAIN · ON THE PHONE ONLY</div>
      <div class="offchain">${['Name', 'Birth date', 'Country', 'Screening result'].map((x) => `<div>${icon('eyeOff', 17, 2.2)}${x}: never on the ledger</div>`).join('')}</div>
    </div>` : `<div class="card result-card" data-result="bad">
      <div class="rc-head"><span class="tick bad">${icon('x', 24, 3)}</span><div><b>Couldn't issue</b><span>${esc(friendly(new Error(li.err ?? '')))}</span></div></div>
      <button class="btn-sec" data-act="tab" data-tab="registry">Open the registry</button></div>`)
    : `<div class="dashed"><span class="ic-circle">${icon('key', 20, 2.2)}</span><div><b>Issue a credential to see what goes on-chain</b><span class="t">Only a hiding commitment. The person's details go to their phone.</span></div></div>`;
  const status = st === 'approved' ? pill('<span class="pdot"></span>Approved issuer', 'ok') : st === 'suspended' ? pill('<span class="pdot"></span>Suspended', 'bad') : pill('<span class="pdot"></span>Not approved yet', 'warn');
  return `<section class="page" data-screen="issuer">
    <div class="page-head"><div><div class="eyebrow">Issuer console</div><h2>${issuer.name}</h2><p>You check someone's ID once, the normal way. Kola ID puts a private credential on their phone and only a commitment on the ledger.</p></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${status}${chip(pureCircuits.issuerKey(issuer.secret), 'white')}</div></div>
    ${st !== 'approved' ? `<div class="sheet-warn">${icon('ban', 18, 2.4)}<span style="flex:1">${issuer.name} isn't an approved issuer${st === 'suspended' ? ' any more' : ' yet'}, so the ledger will refuse its credentials.</span><button class="btn sm" data-act="tab" data-tab="registry">Open registry</button></div>` : ''}
    <div class="two">
      <div class="col">
        <div class="sec-title">People to verify <span class="count">${holders.length}</span></div>
        ${holders.map(person).join('')}
        <details class="card more" id="newHolder"><summary><span class="ic-circle">${icon('userPlus', 20, 2.2)}</span><span style="flex:1">Verify someone new</span>${icon('chevronDown', 18, 2.2)}</summary>
          <div class="inner">
            <div class="form">
              <label class="field">Name (fictional)<input id="iName" placeholder="e.g. Tabe" maxlength="24" autocomplete="off"></label>
              <label class="field">Date of birth<input id="iDob" type="date" value="${dayToIso(MANKA().dobDay)}"></label>
              <label class="field">Country<select id="iCountry">${Object.entries(COUNTRY_NAMES).map(([c, n]) => opt(c, n)).join('')}</select></label>
              <label class="field">Sanctions screening<select id="iSanc">${opt(1, 'Clear')}${opt(0, 'Match found')}</select></label>
              <label class="field">Screened on<input id="iScreened" type="date" value="${dayToIso(todayDay - 10n)}"></label>
              <label class="field">Expires<input id="iExpiry" type="date" value="${dayToIso(todayDay + 365n)}"></label>
            </div>
            <button class="btn" data-act="issueNew" style="align-self:flex-start">${icon('phone', 18, 2.2)}Check ID and issue</button>
          </div></details>
        <div class="sec-title" style="margin-top:6px">Revocations and re-issues</div>
        ${events.length ? `<div class="card events">${events.map((e) => `<div class="ev"><span class="sdot ${e.kind === 'ok' ? '' : 'bad'}"></span><span style="flex:1">${esc(e.text)}</span><span class="muted mono" style="font-size:12.5px">${e.at}</span></div>`).join('')}</div>`
          : `<div class="dashed"><span class="ic-circle">${icon('ban', 20, 2.2)}</span><div><b>No revocations yet</b><span class="t">Revoking zeroes the credential's slot. No app record can be linked back to it.</span></div></div>`}
      </div>
      <div class="col">${result}</div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ registry
function registry() {
  const row = (i: Issuer, k: number) => {
    const status = i.status === 'approved' ? pill('<span class="pdot"></span>Approved', 'ok') : i.status === 'pending' ? pill('<span class="pdot"></span>Pending review', 'warn')
      : i.status === 'suspended' ? pill('<span class="pdot"></span>Suspended', 'bad') : pill('Rejected', 'gray');
    const acts = i.status === 'approved' ? `<button class="btn-ghost danger" data-act="suspend" data-i="${k}">${icon('ban', 16, 2.2)}Suspend</button>`
      : i.status === 'pending' ? `<button class="btn-ghost" data-act="reject" data-i="${k}">Reject</button><button class="btn sm" data-act="approve" data-i="${k}" ${k === 0 ? 'id="addIssuer"' : ''}>${icon('check', 16, 3)}Approve</button>`
      : i.status === 'suspended' ? `<button class="btn-sec" data-act="approve" data-i="${k}" style="height:42px">${icon('rotate', 16, 2.2)}Reinstate</button>` : '<span class="muted" style="font-size:13px">No action</span>';
    return `<div class="trow" data-issuer="${esc(i.name)}" data-status="${i.status}"><div class="iss-cell"><span class="avatar ${i.av}">${i.initials}</span><div style="min-width:0"><b>${i.name}</b><span>${i.place}</span></div></div>
      <div class="c-key">${chip(pureCircuits.issuerKey(i.secret), 'white')}</div><div class="c-status">${status}</div><div class="tacts">${acts}</div></div>`;
  };
  const pending = issuers.filter((i) => i.status === 'pending').length;
  return `<section class="page" data-screen="registry">
    <div class="page-head"><div><div class="eyebrow">Registry admin</div><h2>Who may issue Kola IDs</h2><p>Issuers are accountable companies: KYC vendors, banks and mobile-money operators. Their key hashes are public. The people they verify are not.</p></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="muted" style="font-size:13.5px;font-weight:600">Admin key</span>${chip(sim.ledger.admin, 'white')}</div></div>
    <div class="card table">
      <div class="trow th"><div>ISSUER</div><div class="c-key">KEY HASH</div><div>STATUS</div><div></div></div>
      ${issuers.map(row).join('')}
    </div>
    <div class="two" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div class="card info"><span class="ic-circle">${icon('key', 20, 2.2)}</span><div><b>What approval writes on-chain</b><span>One key hash in the issuers set. No company documents, no customer data.</span></div></div>
      ${pending ? `<div class="card info"><span class="ic-circle">${icon('inbox', 20, 2.2)}</span><div><b>${pending} application${pending > 1 ? 's' : ''} waiting</b><span>Approving lets an issuer's credentials into the Merkle tree.</span></div></div>`
        : `<div class="dashed"><span class="ic-circle">${icon('inbox', 20, 2.2)}</span><div><b>No other applications</b><span class="t">New issuers apply off-chain; the admin approves them here.</span></div></div>`}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ apps
function appsPage() {
  const card = (a: App, k: number) => {
    const p = policyOf(a); const d = a.draft; const pub = p ? draftOf(a) : null;
    const dirty = !pub || !sameDraft(d, pub);
    const count = verifs(a);
    return `<div class="card appcard" data-appcard="${esc(a.name)}">
      <div class="appcard-h"><span class="avatar ${a.av}">${a.name[0]}</span><div class="t"><b>${a.name}</b><span>${a.kind}</span></div>
        <div class="r">${p ? pill(`<span class="pdot"></span>Live · epoch ${p.epoch}`, 'ok') : pill('Not published', 'warn')}${p ? chip(p.owner, 'white') : ''}</div></div>
      <div class="eyebrow gray">RULES</div>
      <div class="editor">
        <div class="erow"><span>Minimum age</span><div class="stepper"><button data-act="age" data-k="${k}" data-d="-1" aria-label="Lower age">${icon('minus', 16, 2.6)}</button><output>${d.minAgeYears ? `${d.minAgeYears}+` : 'Any'}</output><button data-act="age" data-k="${k}" data-d="1" aria-label="Raise age">${icon('plus', 16, 2.6)}</button></div></div>
        <div class="erow"><span>Countries</span><div class="ctys">${EDITOR_COUNTRIES.map((c) => `<button class="cty ${d.countries.includes(c) ? 'on' : ''}" data-act="cty" data-k="${k}" data-c="${c}">${flag(c, 'sm')}${COUNTRY_CODE[c]}</button>`).join('')}</div></div>
        <div class="ehint">${d.countries.length ? `Only ${d.countries.map((c) => COUNTRY_NAMES[c]).join(', ')}` : 'None picked = any country'}</div>
        <div class="erow"><span>Sanctions screening</span><div class="stepper"><button data-act="days" data-k="${k}" data-d="-30" aria-label="Fewer days">${icon('minus', 16, 2.6)}</button><output>${d.maxDays ? `≤ ${d.maxDays} days` : 'Off'}</output><button data-act="days" data-k="${k}" data-d="30" aria-label="More days">${icon('plus', 16, 2.6)}</button></div></div>
      </div>
      ${dirty ? `<div class="publish">${icon('radio', 18, 2.2)}<span>${p ? 'Unpublished changes' : 'Draft: not on the ledger yet'}</span>
        ${p ? `<button class="btn-ghost" data-act="discard" data-k="${k}" style="height:38px">Discard</button>` : ''}<button class="btn sm" data-act="publish" data-k="${k}">${p ? 'Publish changes' : 'Publish rules'}</button></div>` : ''}
      <div class="stat"><div class="n"><b>${count}</b><span>verified ${count === 1n ? 'person' : 'people'} · billable</span></div>
        ${p ? `<button class="btn-sec" data-act="epoch" data-k="${k}" style="height:40px">${icon('rotate', 16, 2.2)}New epoch</button>` : ''}</div>
      <div class="eyebrow gray">WHAT ${a.name.toUpperCase()} RECEIVED</div>
      <div class="vlist">${a.seen.length ? a.seen.slice(0, 6).map((s) => `<div class="vrow">${chip(s.nf)}${pill(s.kind === 'login' ? 'Login' : 'Sign-up', s.kind === 'login' ? 'gray' : 'ok')}<span class="tm">${s.at}</span></div>`).join('')
        : '<div class="vempty">Nothing yet. Every sign-up shows up here as one anonymous ID.</div>'}</div>
    </div>`;
  };
  return `<section class="page" data-screen="apps">
    <div class="page-head"><div><div class="eyebrow">Relying apps</div><h2>Set your rules, get a yes or no</h2><p>Each app publishes its policy on the ledger. People prove they meet it. The app receives one anonymous ID per person, and nothing else.</p></div></div>
    <div class="apps-grid">${apps.map(card).join('')}</div>
    <div class="note"><span class="ic-circle">${icon('shield', 20, 2.2)}</span><div><b>Can the two apps link the same person? No.</b><span>Compare the IDs above: every app sees a different value for Manka, so even pooled databases don't join.</span></div></div>
  </section>`;
}

// ------------------------------------------------------------------ beyond finance
const UC_LOOK: Record<string, { grad: string; ic: string; sub: string; rule: string }> = {
  gaming: { grad: 'linear-gradient(135deg,#D86A2C,#FFC857)', ic: 'ticket', sub: 'Sports betting · 21+ only', rule: 'Age 21+' },
  coop: { grad: 'linear-gradient(135deg,#1E7A46,#3FA56A)', ic: 'leaf', sub: 'Cocoa buyer · members only', rule: 'Active co-op member' },
  jobs: { grad: 'linear-gradient(135deg,#86391B,#D2693A)', ic: 'sun', sub: 'Solar jobs · certified only', rule: 'Certified technician' },
};
function beyond() {
  const all = ucs.every((u) => u.nf);
  const card = (u: UcState, i: number) => {
    const L = UC_LOOK[u.uc.id];
    const status = u.nf ? `<span class="passed"><i>${icon('check', 14, 3.2)}</i>Manka passed</span>${chip(u.nf)}`
      : u.result && !u.result.ok ? `<span class="pill bad">${esc(u.result.text)}</span>`
      : `<button class="btn sm" data-act="ucProve" data-i="${i}">${icon('shield', 16, 2.2)}Prove as Manka</button>`;
    return `<div class="card uc" data-uc="${u.uc.id}" id="uc-${u.uc.id}">
      <div class="uc-top" style="background:${L.grad}"><span class="bubble" style="width:150px;height:150px;right:-40px;top:-50px;background:rgba(255,255,255,.18)"></span>
        <span class="ici">${icon(L.ic, 20, 2.2)}</span><div><b>${u.uc.app.name}</b><span>${L.sub}</span></div></div>
      <div class="uc-body">
        <div class="uc-kv"><span>Rule</span><b>${L.rule}</b></div>
        <div class="uc-kv"><span>Issuer</span><b>${u.uc.issuer}</b></div>
        <div class="uc-kv"><span>Registry</span><b>${u.uc.registry.name}</b></div>
        <div class="uc-learn">${icon('eye', 16, 2.2)}<span>App learns: ${esc(u.uc.appLearns.split(':')[0])}</span></div>
        <div class="uc-status">${status}${u.failText ? '' : `<button class="linkbtn" data-act="ucFail" data-i="${i}">Try: ${esc(u.uc.fail.who)}</button>`}</div>
        ${u.failText ? `<div class="uc-fail" data-fail="${u.failOk ? 'expected' : 'unexpected'}">${esc(u.failText)}<small>${esc(u.uc.fail.story)}</small></div>` : ''}
        <div class="uc-links"><span class="muted">${u.reg.verifications} verified · billable</span><a href="https://github.com/mbanyadev/kola-id/blob/main/${u.uc.doc}" target="_blank" rel="noopener">Use-case page</a></div>
      </div></div>`;
  };
  return `<section class="page" data-screen="beyond">
    <div class="page-head"><div><div class="eyebrow">Beyond finance</div><h2>One person, three very different apps</h2><p>Manka (fictional) is 28, a cocoa co-op member and a certified solar technician. Three issuers each checked one fact, once. Each kind of issuer lives in its own registry, so a co-op can never mint an ID check.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-ghost" data-act="ucReset">${icon('rotate', 16, 2.2)}Reset</button><button class="btn" data-act="ucRun" id="ucRun">${icon('play', 16)}${ucs.some((u) => u.nf) ? 'Run again' : 'Run: Manka passes three apps'}</button></div></div>
    <div class="ucs">${ucs.map(card).join('')}</div>
    ${all ? `<div class="note" data-summary="1"><span class="ic-circle">${icon('check', 20, 3)}</span><div><b>Manka passed all three. Can they link her? No.</b><span>Three different anonymous IDs: ${ucs.map((u) => short(u.nf!)).join(', ')}. Even pooled, nothing joins.</span></div></div>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ network
type Dep = { contractAddress?: string; deployTxId?: string; deployBlock?: number; deployedAt?: string; steps: Record<string, { label: string; ok: boolean; block?: number; refused?: string }> };
const preprod = preprodDeployment as Dep;
const PREPROD_EXPLORER = 'https://preprod.midnightexplorer.com';
function network() {
  const steps = Object.values(preprod.steps ?? {});
  const addr = preprod.contractAddress;
  return `<section class="page" data-screen="network">
    <div class="page-head"><div><div class="eyebrow">Network</div><h2>Live on Midnight</h2><p>The same Kola ID contract runs on Midnight Preprod. This page runs it in your browser, and Lace can deploy your own copy.</p></div></div>
    <div class="net">
      <div class="card netcard">
        <span class="bubble" style="width:220px;height:220px;right:-70px;top:-90px;background:var(--k-peach)"></span>
        <div class="netcard-h"><span class="ic-circle">${icon('radio', 22, 2.2)}</span><div><b>Reference deployment</b><span class="t">Midnight Preprod · deployed from Node.js</span></div><span class="spacer"></span>${pill('<span class="pdot"></span>Live', 'ok')}</div>
        ${addr ? `<div class="onchain">
          <div class="kv"><span>Contract</span>${chip(addr, 'white')}</div>
          <div class="kv"><span>Deployed</span><span class="v">${preprod.deployedAt ? fmtIso(preprod.deployedAt.slice(0, 10)) : '?'}${preprod.deployBlock ? ` · block ${preprod.deployBlock}` : ''}</span></div>
          <div class="kv"><span>Story on Preprod</span><span class="v">${steps.filter((s) => s.ok).length} landed · ${steps.filter((s) => !s.ok).length} refused by the proof</span></div></div>
        <a class="extlink" href="${PREPROD_EXPLORER}/contracts/${esc(addr)}" target="_blank" rel="noopener">View on the Preprod explorer ${icon('external', 16, 2.2)}</a>
        <div class="eyebrow gray">THE STORY ON PREPROD</div>
        <div class="steplist">${steps.map((s) => `<div><span class="sdot ${s.ok ? '' : 'bad'}"></span><span>${esc(s.label)}</span><span class="muted">${s.ok ? (s.block ? `<a href="${PREPROD_EXPLORER}/blocks/${s.block}" target="_blank" rel="noopener">block ${s.block}</a>` : 'ok') : `refused: ${esc(s.refused ?? '')}`}</span></div>`).join('')}</div>`
        : '<p>Reference deployment pending.</p>'}
        <p style="font-size:13.5px">Preprod's public indexer needs a project token, so this page links to the explorer instead of querying it from your browser.</p>
      </div>
      <div class="col">
        <div class="card netcard">
          <div class="netcard-h"><span class="ic-circle">${icon('wallet', 22, 2.2)}</span><div><b>Deploy your own</b><span class="t">Lace wallet · Midnight Preview</span></div></div>
          <div id="laceRoot" class="lace"><div class="msg">Loading the Midnight client…</div></div>
        </div>
        <div class="card browser"><span class="ic-circle ok">${icon('monitor', 22, 2.2)}</span><div class="tx"><b>Running in your browser</b><span>The real compiled circuits, against a local ledger. Nothing leaves this tab.</span></div>
          <button class="btn-sec" data-act="reset" style="height:42px">${icon('rotate', 16, 2.2)}Reset demo</button></div>
      </div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ ledger drawer
function ledgerDrawer() {
  const L = sim.ledger;
  const lrow = (k: string, v: string) => `<div class="lrow"><span>${k}</span><div class="lv">${v}</div></div>`;
  const none = '<span class="muted">none yet</span>';
  const nfsFor = (a: App) => a.seen.filter((s) => s.kind === 'sign-up').map((s) => chip(s.nf)).join('');
  const pols = apps.filter((a) => policyOf(a)).map((a) => lrow(`${a.name.split(' ')[0]} · epoch ${policyOf(a)!.epoch}`, `${chip(policyOf(a)!.owner)}<span class="muted">${verifs(a)} verified</span>`)).join('');
  const ucUsed = ucs.filter((u) => u.manka || u.failText);
  const regs = ucUsed.map((u) => {
    const R = u.reg.sim.ledger;
    return `<div class="reg-mini"><b>${u.uc.registry.name}</b>${lrow('Credentials', `<b>${R.issuedCount}</b>`)}${lrow(u.uc.app.name, `<span class="muted">${u.reg.verifications} verified</span>${[...R.nullifiers].map((n) => chip(n)).join('')}`)}</div>`;
  }).join('');
  return `<div class="scrim" data-act="closeLedger"></div>
  <aside class="drawer" role="dialog" aria-label="Public ledger" id="ledger">
    <div class="drawer-h"><span class="ic-circle">${icon('ledger', 22, 2.2)}</span><div class="t"><b>Public ledger</b><span>What anyone in the world can read</span></div><button class="icon-btn" data-act="closeLedger" aria-label="Close">${icon('x', 18)}</button></div>
    <div class="drawer-b">
      <div class="lsec"><div class="eyebrow gray">CONTRACT</div>
        ${lrow('Admin', chip(L.admin))}
        ${lrow('Approved issuers', [...L.issuers].map((n) => chip(n)).join('') || none)}</div>
      <div class="hr"></div>
      <div class="lsec"><div class="eyebrow gray">CREDENTIALS</div>
        ${lrow('Issued', `<b>${L.issuedCount}</b>`)}${lrow('Revoked', `<b>${L.revokedCount}</b>`)}${lrow('Merkle root', chip(rootHex(sim)))}</div>
      <div class="hr"></div>
      <div class="lsec"><div class="eyebrow gray">APP POLICIES</div>${pols || lrow('Published', none)}</div>
      <div class="hr"></div>
      <div class="lsec"><div class="eyebrow gray">ANONYMOUS IDS (NULLIFIERS)</div>
        ${apps.map((a) => lrow(a.name, nfsFor(a) || none)).join('')}<span class="muted" style="font-size:13px">${[...L.nullifiers].length} in total</span></div>
      <div class="lnote">${icon('eyeOff', 20, 2.2)}No names, birth dates, countries or issuer-per-person anywhere above.</div>
      ${regs ? `<div class="hr"></div><div class="lsec"><div class="eyebrow gray">BEYOND FINANCE REGISTRIES</div>${regs}</div>` : ''}
      <div class="hr"></div>
      <div class="lsec"><div class="eyebrow gray">ACTIVITY</div><div class="timeline" id="log">${timeline.slice(-40).reverse().map((t) => `<div class="tl ${t.kind === 'bad' ? 'bad' : ''}"><span class="sdot ${t.kind === 'bad' ? 'bad' : ''}"></span><span class="tx">${esc(t.text)}</span><span class="tm">${t.at}</span></div>`).join('')}</div></div>
    </div>
  </aside>`;
}

// ------------------------------------------------------------------ render + events
let previewMod: typeof import('./preview.js') | null = null;
function mountPreview() {
  const el = document.getElementById('laceRoot'); if (!el) return;
  const draw = () => { const r = document.getElementById('laceRoot'); if (tab === 'network' && r && previewMod) previewMod.mount(r, (t, k) => log(t, k ?? ''), draw); };
  if (previewMod) { draw(); return; }
  import('./preview.js').then((m) => { previewMod = m; draw(); })
    .catch((e) => { el.innerHTML = `<div class="msg bad">Could not load the Midnight client: ${esc(String(e))}</div>`; });
}

const hashFor = (t: Tab) => (t === 'beyond' ? '#beyond-finance' : t === 'story' ? '' : `#${t}`);
function render() {
  const body = tab === 'story' ? hub() : tab === 'wallet' ? wallet() : tab === 'issuer' ? issuerPage() : tab === 'registry' ? registry()
    : tab === 'apps' ? appsPage() : tab === 'beyond' ? beyond() : network();
  const scroll = document.querySelector('.drawer-b')?.scrollTop ?? 0;
  const openDetails = (document.getElementById('newHolder') as HTMLDetailsElement | null)?.open;
  root.classList.toggle('still', root.dataset.tab === tab); // only animate the page in when the tab changes
  root.innerHTML = shell(body);
  root.dataset.tab = tab;
  const db = document.querySelector('.drawer-b'); if (db) db.scrollTop = scroll;
  const nh = document.getElementById('newHolder') as HTMLDetailsElement | null; if (nh && openDetails) nh.open = true;
  const mobile = matchMedia('(max-width: 760px)').matches;
  document.body.style.overflow = drawerOpen || moreOpen || (mobile && tab === 'wallet' && (sheetOpen || outcome)) ? 'hidden' : '';
  drawToast();
  if (tab === 'network') mountPreview();
  const h = hashFor(tab);
  if (location.hash !== h && !(tab === 'beyond' && location.hash === '#beyond-finance-run')) history.replaceState(null, '', h || location.pathname + location.search);
}

/** Leaving the wallet dismisses a finished result, so coming back shows a fresh request. */
function leaveWallet(t: Tab) { if (t !== 'wallet' && outcome?.kind !== 'proving') { outcome = null; sheetOpen = false; } }
function go(t: Tab) { leaveWallet(t); tab = t; moreOpen = false; drawerOpen = false; sheetOpen = false; render(); scrollTo({ top: 0 }); }

function copy(h: string, el: HTMLElement) {
  navigator.clipboard?.writeText(h).catch(() => undefined);
  el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 1200);
  toast('Copied the full hash'); drawToast();
}

function walletProveAsync(returning: boolean) {
  const hn = currentHolder; const an = reqApp;
  sheetOpen = true;
  outcome = { kind: 'proving', app: an, holder: hn, returning, title: '', text: '' }; render();
  setTimeout(() => { walletProve(hn, an, returning); render(); }, 900);
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>('[data-act]');
  if (!el) {
    // tapping the dimmed area around the mobile request sheet closes it
    if (target.classList.contains('wallet-r') && target.classList.contains('open') && outcome?.kind !== 'proving') { sheetOpen = false; outcome = null; render(); }
    return;
  }
  const d = el.dataset; const k = Number(d.k ?? d.i ?? 0);
  switch (d.act) {
    case 'tab': go(d.tab as Tab); break;
    case 'ledger': drawerOpen = !drawerOpen; moreOpen = false; render(); break;
    case 'closeLedger': drawerOpen = false; render(); break;
    case 'more': moreOpen = !moreOpen; drawerOpen = false; render(); break;
    case 'closeMore': moreOpen = false; render(); break;
    case 'copy': copy(d.h!, el); break;
    case 'reset': reset(); moreOpen = false; drawerOpen = false; toast('Fresh start: a new contract on a new local ledger.'); go('story'); break;
    // story
    case 'play': if (playing) { stopPlay(); render(); } else startPlay(); break;
    case 'pause': stopPlay(); render(); break;
    case 'next': if (playTimer) clearTimeout(playTimer); playNext(); break;
    case 'skip': stopPlay(); runUpTo(STEPS.length - 1); tab = 'story'; toast('Ran all 8 steps. Open the ledger to see what is public.'); render(); scrollTo({ top: 0 }); break;
    case 'step': { stopPlay(); const i = Number(d.step); if (done.has(i)) tab = STEPS[i].tab; else runUpTo(i); render(); scrollTo({ top: 0 }); break; }
    // wallet
    case 'holder': currentHolder = d.holder!; outcome = null; render(); break;
    case 'reqApp': reqApp = d.app!; outcome = null; render(); break;
    case 'review': reqApp = d.app!; outcome = null; sheetOpen = true; render(); break;
    case 'closeSheet': sheetOpen = false; if (outcome?.kind !== 'proving') outcome = null; render(); break;
    case 'closeOutcome': outcome = null; sheetOpen = false; render(); break;
    case 'prove': if (outcome?.kind !== 'proving') walletProveAsync(false); break;
    case 'login': if (outcome?.kind !== 'proving') walletProveAsync(true); break;
    // issuer
    case 'issue': {
      const h = byName(d.holder!); const re = h.revoked; const r = issue(h, h.facts ?? MANKA());
      lastIssue = r.ok ? { ok: true, names: [h.name], leaf: toHex(h.leaf!), root: rootHex(sim), reissue: re } : { ok: false, names: [h.name], err: r.err };
      render(); break;
    }
    case 'revoke': revoke(byName(d.holder!)); render(); break;
    case 'issueNew': {
      const name = val('iName').trim().replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 24);
      if (!name) { toast('Give the new person a (fictional) name first.', true); drawToast(); (document.getElementById('iName') as HTMLInputElement).focus(); break; }
      const facts: Facts = { dobDay: dayNumber(val('iDob')), country: Number(val('iCountry')), sanctionsClear: val('iSanc') === '1', screenedDay: dayNumber(val('iScreened')), expiryDay: dayNumber(val('iExpiry')) };
      let h = holders.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!h) { h = { name, secret: randomBytes32(), revoked: false, av: 'av-gray', joined: [], preset: false }; holders.push(h); }
      const prevFacts = h.facts; h.facts = facts;
      const r = issue(h, facts);
      if (!r.ok && !h.credential) h.facts = prevFacts ?? facts;
      lastIssue = r.ok ? { ok: true, names: [h.name], leaf: toHex(h.leaf!), root: rootHex(sim) } : { ok: false, names: [h.name], err: r.err };
      render(); break;
    }
    // registry
    case 'approve': approveIssuer(issuers[k]); render(); break;
    case 'suspend': removeIssuer(issuers[k]); render(); break;
    case 'reject': rejectIssuer(issuers[k]); render(); break;
    // apps
    case 'age': { const a = apps[k]; a.draft.minAgeYears = Math.max(0, Math.min(30, a.draft.minAgeYears + Number(d.d))); render(); break; }
    case 'days': { const a = apps[k]; a.draft.maxDays = Math.max(0, Math.min(360, a.draft.maxDays + Number(d.d))); a.draft.sanctions = a.draft.maxDays > 0; render(); break; }
    case 'cty': { const a = apps[k]; const c = Number(d.c); a.draft.countries = a.draft.countries.includes(c) ? a.draft.countries.filter((x) => x !== c) : [...a.draft.countries, c]; render(); break; }
    case 'discard': apps[k].draft = draftOf(apps[k]); render(); break;
    case 'publish': savePolicy(apps[k], apps[k].draft); render(); break;
    case 'epoch': bumpEpoch(apps[k]); render(); break;
    // beyond finance
    case 'ucRun': ucRunAll(); toast('Manka passed all three apps, and the three fail cases were refused.'); render(); break;
    case 'ucReset': resetUseCases(); render(); break;
    case 'ucProve': ucProve(ucs[k]); render(); break;
    case 'ucFail': ucFail(ucs[k]); render(); break;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawerOpen || moreOpen) { drawerOpen = false; moreOpen = false; render(); }
  else if (tab === 'wallet' && (sheetOpen || outcome) && outcome?.kind !== 'proving') { sheetOpen = false; outcome = null; render(); }
});

const HASH_TAB: Record<string, Tab> = { '#wallet': 'wallet', '#apps': 'apps', '#issuer': 'issuer', '#registry': 'registry', '#network': 'network', '#preview': 'network', '#story': 'story' };
function fromHash() {
  if (location.hash.startsWith('#beyond-finance')) { tab = 'beyond'; if (location.hash === '#beyond-finance-run') ucRunAll(); }
  else tab = HASH_TAB[location.hash] ?? 'story';
}
window.addEventListener('hashchange', () => { const was = tab; fromHash(); if (tab !== was) leaveWallet(tab); drawerOpen = false; moreOpen = false; render(); scrollTo({ top: 0 }); });
reset();
fromHash();
render();
