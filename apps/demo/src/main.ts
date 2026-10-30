// SPDX-License-Identifier: Apache-2.0
// Kola ID web demo. Runs the compiled Kola ID Compact circuits in the browser against a local copy
// of the public ledger (the same simulator the test suite uses). Each actor has its own private state.
import './style.css';
import {
  KolaSimulator, makeCredential, makePolicy, pureCircuits, randomBytes32, labelBytes32, toHex,
  dayNumber, dayToIso, minAgeDays, COUNTRY, type Credential, type KolaPrivateState,
  USE_CASES, UseCaseRegistry, runFailCase, type UseCase,
} from '../../../sdk/src/index.js';

// ------------------------------------------------------------------ model
const COUNTRY_NAMES: Record<number, string> = {
  [COUNTRY.Cameroon]: 'Cameroon', [COUNTRY.Ghana]: 'Ghana', [COUNTRY.Kenya]: 'Kenya',
  [COUNTRY.Nigeria]: 'Nigeria', [COUNTRY.France]: 'France', [COUNTRY.Iran]: 'Iran',
};
const todayDay = dayNumber(new Date().toISOString().slice(0, 10));
const yearsAgo = (y: number, extraDays = 0) => {
  const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y);
  return dayNumber(d.toISOString().slice(0, 10)) + BigInt(extraDays);
};

interface Holder { name: string; secret: Uint8Array; credential?: Credential; salt?: Uint8Array; leaf?: Uint8Array; revoked: boolean; }
interface App { name: string; id: Uint8Array; secret: Uint8Array; seen: { nf: string; at: string; kind: string }[]; }
interface Issuer { name: string; secret: Uint8Array; approved: boolean; }

let sim: KolaSimulator;
let adminSecret: Uint8Array;
let issuer: Issuer;
let holders: Holder[];
let apps: App[];
type Tab = 'admin' | 'issuer' | 'holder' | 'apps' | 'usecases' | 'preview';
let tab: Tab = 'admin';
let currentHolder = 'Manka';
let lastResult: { ok: boolean; text: string } | null = null;
const done = new Set<number>();

// "Beyond finance" presets: one person (Manka), three registries, three apps.
interface UcState { uc: UseCase; reg: UseCaseRegistry; manka?: KolaPrivateState; leaf?: string; nf?: string; result?: { ok: boolean; text: string }; failText?: string; }
let ucs: UcState[] = [];
let mankaUcSecret = randomBytes32();
function resetUseCases() {
  mankaUcSecret = randomBytes32();
  ucs = USE_CASES.map((uc) => ({ uc, reg: new UseCaseRegistry(uc, todayDay) }));
}

function reset() {
  adminSecret = randomBytes32();
  sim = new KolaSimulator(adminSecret, todayDay);
  issuer = { name: 'Kumba Verify', secret: randomBytes32(), approved: false };
  holders = [
    { name: 'Manka', secret: randomBytes32(), revoked: false },
    { name: 'Ebai', secret: randomBytes32(), revoked: false },
  ];
  apps = [
    { name: 'Sawa Exchange', id: labelBytes32('sawa-exchange'), secret: randomBytes32(), seen: [] },
    { name: 'Ndole Games', id: labelBytes32('ndole-games'), secret: randomBytes32(), seen: [] },
  ];
  done.clear(); lastResult = null; logEl.innerHTML = '';
  resetUseCases();
  log('Kola ID contract deployed (local simulator). Admin key hash written to the ledger.', 'ok');
}

// ------------------------------------------------------------------ helpers
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const short = (b: Uint8Array | string) => { const h = typeof b === 'string' ? b : toHex(b); return h.slice(0, 10) + '…' + h.slice(-6); };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function log(text: string, kind: 'ok' | 'bad' | '' = '') {
  const li = document.createElement('li'); li.className = kind; li.textContent = text; logEl.prepend(li);
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
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of FRIENDLY) if (re.test(msg)) return text;
  return msg;
}

function attempt(label: string, f: () => string | void): boolean {
  try {
    const extra = f();
    lastResult = { ok: true, text: `${label}: done${extra ? '. ' + extra : ''}` };
    log(lastResult.text, 'ok'); return true;
  } catch (e) {
    lastResult = { ok: false, text: `${label}: ${friendly(e)}` };
    log(lastResult.text, 'bad'); return false;
  } finally { render(); }
}

function holderPs(h: Holder): KolaPrivateState {
  return { holderSecret: h.secret, credential: h.credential, salt: h.salt };
}

// ------------------------------------------------------------------ actions
function approveIssuer() {
  return attempt('Admin approves Kumba Verify', () => {
    sim.addIssuer(adminSecret, pureCircuits.issuerKey(issuer.secret)); issuer.approved = true;
  });
}
function removeIssuer() {
  return attempt('Admin removes Kumba Verify', () => {
    sim.removeIssuer(adminSecret, pureCircuits.issuerKey(issuer.secret)); issuer.approved = false;
  });
}
function issue(h: Holder, a: { dobDay: bigint; country: number; sanctionsClear: boolean; screenedDay: bigint; expiryDay: bigint }) {
  return attempt(`Kumba Verify issues a credential to ${h.name}`, () => {
    const c = makeCredential(issuer.secret, pureCircuits.holderKey(h.secret), a);
    sim.issueCredential(issuer.secret, c.leaf);
    Object.assign(h, { credential: c.credential, salt: c.salt, leaf: c.leaf, revoked: false });
    return `Only the commitment ${short(c.leaf)} went on-chain`;
  });
}
function revoke(h: Holder) {
  return attempt(`Kumba Verify revokes ${h.name}'s credential`, () => {
    sim.revokeCredential(issuer.secret, h.credential!, h.salt!); h.revoked = true;
    return 'Slot zeroed and root history reset; no app record can be linked to it';
  });
}
function savePolicy(app: App, p: { minAgeYears: number; countries: number[]; sanctions: boolean; maxDays: number; epoch?: bigint }) {
  return attempt(`${app.name} publishes its policy`, () => {
    const epoch = p.epoch ?? (sim.ledger.policies.member(app.id) ? sim.ledger.policies.lookup(app.id).epoch : 0n);
    sim.setPolicy(app.secret, app.id, makePolicy(pureCircuits.appKey(app.secret), {
      minAgeDays: minAgeDays(p.minAgeYears), countries: p.countries,
      requireSanctionsClear: p.sanctions, maxScreenAgeDays: BigInt(p.maxDays), epoch,
    }));
  });
}
function bumpEpoch(app: App) {
  return attempt(`${app.name} opens a new sign-up epoch`, () => {
    const p = sim.ledger.policies.lookup(app.id);
    sim.setPolicy(app.secret, app.id, { ...p, epoch: p.epoch + 1n });
  });
}
function prove(h: Holder, app: App, returning = false) {
  return attempt(`${h.name} ${returning ? 'logs in to' : 'signs up to'} ${app.name} with Kola ID`, () => {
    const nf = returning ? sim.proveReturning(holderPs(h), app.id, todayDay) : sim.proveForApp(holderPs(h), app.id, todayDay);
    app.seen.unshift({ nf: toHex(nf), at: new Date().toLocaleTimeString(), kind: returning ? 'login' : 'sign-up' });
    return `${app.name} received only the nullifier ${short(nf)}`;
  });
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
  try { msg = runFailCase(u.reg); } catch (e) { msg = `unexpected: ${e instanceof Error ? e.message : String(e)}`; }
  u.failText = u.uc.fail.expect.test(msg)
    ? `❌ ${u.uc.fail.who} → ${u.uc.app.name}: ${u.uc.fail.outcome}`
    : `${u.uc.fail.who} → ${u.uc.app.name}: ${friendly(new Error(msg))}`;
  log(u.failText, 'bad');
}
function ucRunAll() {
  resetUseCases();
  ucs.forEach((u) => { ucIssue(u); ucProve(u); ucFail(u); });
}

const byName = (n: string) => holders.find((h) => h.name === n)!;
const app = (n: string) => apps.find((a) => a.name === n)!;
const SAWA_POLICY = { minAgeYears: 18, countries: [COUNTRY.Cameroon, COUNTRY.Ghana, COUNTRY.Kenya, COUNTRY.Nigeria], sanctions: true, maxDays: 90 };
const NDOLE_POLICY = { minAgeYears: 18, countries: [], sanctions: false, maxDays: 0 };
const MANKA = () => ({ dobDay: dayNumber('1998-05-14'), country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: todayDay - 10n, expiryDay: todayDay + 365n });
const EBAI = () => ({ dobDay: yearsAgo(17), country: COUNTRY.Cameroon, sanctionsClear: true, screenedDay: todayDay - 5n, expiryDay: todayDay + 365n });

const STEPS: { label: string; tab: Tab; run: () => void }[] = [
  { label: '1 Approve issuer', tab: 'admin', run: () => { approveIssuer(); } },
  { label: '2 Issue Manka + Ebai', tab: 'issuer', run: () => { issue(byName('Manka'), MANKA()); issue(byName('Ebai'), EBAI()); } },
  { label: '3 Apps publish policies', tab: 'apps', run: () => { savePolicy(app('Sawa Exchange'), SAWA_POLICY); savePolicy(app('Ndole Games'), NDOLE_POLICY); } },
  { label: '4 Manka → Sawa ✅', tab: 'holder', run: () => { currentHolder = 'Manka'; prove(byName('Manka'), app('Sawa Exchange')); } },
  { label: '5 Manka again ❌', tab: 'holder', run: () => { currentHolder = 'Manka'; prove(byName('Manka'), app('Sawa Exchange')); } },
  { label: '6 Manka → Ndole ✅', tab: 'apps', run: () => { currentHolder = 'Manka'; prove(byName('Manka'), app('Ndole Games')); } },
  { label: '7 Ebai → Sawa ❌', tab: 'holder', run: () => { currentHolder = 'Ebai'; prove(byName('Ebai'), app('Sawa Exchange')); } },
  { label: '8 Revoke + re-issue', tab: 'holder', run: () => {
      currentHolder = 'Manka'; const m = byName('Manka');
      revoke(m); prove(m, app('Sawa Exchange'), true); issue(m, MANKA()); prove(m, app('Sawa Exchange'), true);
    } },
];

// ------------------------------------------------------------------ rendering
function renderSteps() {
  $('steps').innerHTML = STEPS.map((s, i) => `<li class="${done.has(i) ? 'done' : ''}"><button class="ghost" data-step="${i}">${s.label}</button></li>`).join('');
}

function policyText(appId: Uint8Array): string {
  if (!sim.ledger.policies.member(appId)) return '<p class="muted">No policy published yet.</p>';
  const p = sim.ledger.policies.lookup(appId);
  const countries = p.countries.filter((c) => c !== 0n).map((c) => COUNTRY_NAMES[Number(c)] ?? String(c));
  const years = p.minAgeDays === 0n ? 0 : Math.round(Number(p.minAgeDays) / 365.25);
  return `<ul class="policy">
    <li>${years ? `Age ${years}+` : 'No age check'}</li>
    <li>${countries.length ? 'Country in ' + countries.join(', ') : 'Any country'}</li>
    <li>${p.requireSanctionsClear ? `Sanctions screening clear, at most ${p.maxScreenAgeDays} days old` : 'No sanctions screening required'}</li>
    <li>Sign-up epoch ${p.epoch}</li></ul>
    <p class="muted">The app learns: <b>one nullifier</b> (unique to you, this app and this epoch). No name, birth date, country or issuer.</p>`;
}

function renderPanel() {
  const panel = $('panel');
  $('tabs').innerHTML = (['admin', 'issuer', 'holder', 'apps', 'usecases', 'preview'] as const).map((t) =>
    `<button class="${t === tab ? 'active' : 'ghost'}${t === 'usecases' ? ' new' : ''}" data-tab="${t}">${{ admin: 'Registry admin', issuer: 'Issuer · Kumba Verify', holder: 'Holder wallet', apps: 'Apps', usecases: 'Beyond finance', preview: 'Lace / Preview' }[t]}</button>`).join('');
  const result = lastResult ? `<div class="result ${lastResult.ok ? 'ok' : 'bad'}">${lastResult.ok ? '✅' : '❌'} ${esc(lastResult.text)}</div>` : '';

  if (tab === 'admin') {
    panel.innerHTML = `<div class="card"><span class="tag">Registry admin</span><h3>Approved issuers</h3>
      <p class="muted">Issuers are accountable companies (KYC vendors, banks, mobile-money operators). Their key hashes are public; the people they verify are not.</p>
      <table><tr><th>Issuer</th><th>Key hash</th><th>Status</th><th></th></tr>
      <tr><td>${issuer.name}</td><td class="mono">${short(pureCircuits.issuerKey(issuer.secret))}</td><td>${issuer.approved ? '✅ approved' : '— not approved'}</td>
      <td>${issuer.approved ? '<button class="ghost" id="rmIssuer">Remove</button>' : '<button id="addIssuer">Approve</button>'}</td></tr></table>${result}</div>`;
    $('addIssuer')?.addEventListener('click', approveIssuer);
    $('rmIssuer')?.addEventListener('click', removeIssuer);
  }

  if (tab === 'issuer') {
    panel.innerHTML = `<div class="card"><span class="tag">Issuer · ${issuer.name}</span><h3>Issue a credential after your normal KYC check</h3>
      <div class="row">
        <label>Holder<select id="iHolder">${holders.map((h) => `<option>${h.name}</option>`).join('')}<option value="__new">+ new holder…</option></select></label>
        <label>Date of birth<input id="iDob" type="date" value="${dayToIso(MANKA().dobDay)}"></label>
        <label>Country<select id="iCountry">${Object.entries(COUNTRY_NAMES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
      </div><div class="row">
        <label>Sanctions screening<select id="iSanc"><option value="1">Clear</option><option value="0">Match found</option></select></label>
        <label>Screened on<input id="iScreened" type="date" value="${dayToIso(todayDay - 10n)}"></label>
        <label>Expires<input id="iExpiry" type="date" value="${dayToIso(todayDay + 365n)}"></label>
        <button id="doIssue">Issue credential</button>
      </div>
      <p class="muted">The attributes go to the holder's wallet. Only a hiding commitment is written to the ledger.</p>${result}</div>
      <div class="card"><h3>Issued credentials</h3><table><tr><th>Holder</th><th>Commitment (public)</th><th>Status</th><th></th></tr>
      ${holders.filter((h) => h.leaf).map((h) => `<tr><td>${h.name}</td><td class="mono">${short(h.leaf!)}</td><td>${h.revoked ? '⛔ revoked' : '✅ active'}</td>
        <td>${h.revoked ? '' : `<button class="ghost" data-revoke="${h.name}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet</td></tr>'}</table></div>`;
    $('doIssue').addEventListener('click', () => {
      let name = ($('iHolder') as HTMLSelectElement).value;
      if (name === '__new') {
        name = (prompt('Holder name (fictional)') || '').trim(); if (!name) return;
        if (!holders.some((h) => h.name === name)) holders.push({ name, secret: randomBytes32(), revoked: false });
      }
      issue(byName(name), {
        dobDay: dayNumber(($('iDob') as HTMLInputElement).value), country: Number(($('iCountry') as HTMLSelectElement).value),
        sanctionsClear: ($('iSanc') as HTMLSelectElement).value === '1', screenedDay: dayNumber(($('iScreened') as HTMLInputElement).value),
        expiryDay: dayNumber(($('iExpiry') as HTMLInputElement).value),
      });
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((b) => b.addEventListener('click', () => revoke(byName(b.dataset.revoke!))));
  }

  if (tab === 'holder') {
    const h = byName(currentHolder);
    const c = h.credential;
    panel.innerHTML = `<div class="card"><div class="row"><label>Wallet of<select id="hSel">${holders.map((x) => `<option ${x.name === h.name ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label></div></div>
      <div class="card private"><span class="tag">Private · stays on ${h.name}'s device</span><h3>${h.name}'s Kola ID credential</h3>
      ${c ? `<table><tr><td>Born</td><td>${dayToIso(c.dobDay)}</td></tr><tr><td>Country</td><td>${COUNTRY_NAMES[Number(c.country)] ?? c.country}</td></tr>
        <tr><td>Sanctions</td><td>${c.sanctionsClear ? 'clear' : 'match'} (screened ${dayToIso(c.screenedDay)})</td></tr>
        <tr><td>Expires</td><td>${dayToIso(c.expiryDay)}</td></tr><tr><td>Issuer</td><td>${issuer.name}</td></tr>
        <tr><td>Status</td><td>${h.revoked ? '⛔ revoked by issuer' : '✅ active'}</td></tr></table>`
        : '<p class="muted">No credential yet. Ask the issuer.</p>'}</div>
      ${apps.map((a) => `<div class="card"><span class="tag">Verify with Kola ID</span><h3>${a.name} will check</h3>${policyText(a.id)}
        <div class="row"><button data-prove="${a.name}">Sign up with Kola ID</button><button class="ghost" data-login="${a.name}">Log in (returning)</button></div></div>`).join('')}
      ${result}`;
    $('hSel').addEventListener('change', (e) => { currentHolder = (e.target as HTMLSelectElement).value; lastResult = null; render(); });
    panel.querySelectorAll<HTMLButtonElement>('[data-prove]').forEach((b) => b.addEventListener('click', () => prove(h, app(b.dataset.prove!))));
    panel.querySelectorAll<HTMLButtonElement>('[data-login]').forEach((b) => b.addEventListener('click', () => prove(h, app(b.dataset.login!), true)));
  }

  if (tab === 'apps') {
    panel.innerHTML = apps.map((a, i) => {
      const count = sim.ledger.verifications.member(a.id) ? sim.ledger.verifications.lookup(a.id).read() : 0n;
      const p = sim.ledger.policies.member(a.id) ? sim.ledger.policies.lookup(a.id) : null;
      const cs = p ? p.countries.filter((c) => c !== 0n).map(Number) : (i === 0 ? SAWA_POLICY.countries : []);
      const yrs = p ? Math.round(Number(p.minAgeDays) / 365.25) : 18;
      return `<div class="card"><span class="tag">Relying app</span><h3>${a.name}</h3>
        <div class="row"><label>Min age<input type="number" min="0" max="99" value="${yrs}" data-f="age"></label>
          <label>Max screening age (days, 0 = not required)<input type="number" min="0" value="${p ? (p.requireSanctionsClear ? p.maxScreenAgeDays : 0) : (i === 0 ? 90 : 0)}" data-f="days"></label></div>
        <div class="chips">${Object.entries(COUNTRY_NAMES).map(([c, n]) => `<label class="chip"><span><input type="checkbox" value="${c}" data-f="cty" ${cs.includes(Number(c)) ? 'checked' : ''}> ${n}</span></label>`).join('')}</div>
        <p class="muted">No country ticked = any country.</p>
        <div class="row"><button data-save="${i}">${p ? 'Update policy' : 'Publish policy'}</button>${p ? `<button class="ghost" data-epoch="${i}">New epoch</button>` : ''}</div>
        <p><b>${count}</b> verified users (billable)</p>
        <table><tr><th>What ${a.name} received</th><th>Type</th><th>Time</th></tr>${a.seen.map((s) => `<tr><td class="mono">${short(s.nf)}</td><td>${s.kind}</td><td>${s.at}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet</td></tr>'}</table></div>`;
    }).join('') + `<div class="card"><h3>Can the two apps link the same person?</h3><p class="muted">Compare the nullifiers above: every value is different per app, so even if the apps share their databases, they cannot tell that Manka used both.</p></div>${result}`;
    panel.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((b) => b.addEventListener('click', () => {
      const card = b.closest('.card')!; const a = apps[Number(b.dataset.save)];
      const days = Number((card.querySelector('[data-f=days]') as HTMLInputElement).value);
      savePolicy(a, {
        minAgeYears: Number((card.querySelector('[data-f=age]') as HTMLInputElement).value),
        countries: Array.from(card.querySelectorAll<HTMLInputElement>('[data-f=cty]:checked')).map((x) => Number(x.value)),
        sanctions: days > 0, maxDays: days,
      });
    }));
    panel.querySelectorAll<HTMLButtonElement>('[data-epoch]').forEach((b) => b.addEventListener('click', () => bumpEpoch(apps[Number(b.dataset.epoch)])));
  }
  if (tab === 'usecases') {
    const creds = ucs.filter((u) => u.manka).map((u) => `<tr><td>${u.uc.registry.name}</td><td>${u.uc.issuer}</td><td>${esc(u.uc.checkMeaning)}</td></tr>`).join('');
    panel.innerHTML = `<div class="card intro"><span class="tag">Beyond finance · same contract, three registries</span>
      <h3>One person, three apps: betting, cocoa buying, hiring</h3>
      <p>Manka (fictional) is 28, a member of a cocoa co-op and a certified solar technician. Three issuers have each checked one fact about her, once. Each kind of issuer lives in its own Kola ID registry, so a co-op can never mint an ID check and an institute can never mint a co-op membership.</p>
      <div class="row"><button id="ucRun">▶ Run: Manka passes three apps</button><button class="ghost" id="ucReset">Reset</button></div></div>
      <div class="card private"><span class="tag">Private · stays on Manka's device</span><h3>Manka's credentials</h3>
      ${creds ? `<table><tr><th>Registry</th><th>Issued by</th><th>Says</th></tr>${creds}</table>` : '<p class="muted">None yet. Issue below or press Run.</p>'}</div>
      ${ucs.map((u, i) => `<div class="card uc" id="uc-${u.uc.id}"><span class="tag">${u.uc.industry}</span>
        <h3>${u.uc.app.name} <small class="muted">${esc(u.uc.app.does)}</small></h3>
        <div class="ucgrid"><div><b>Public policy</b><ul class="policy">${u.uc.policyLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
        <div><b>Issuer</b><p class="muted">${u.uc.issuer}, in the ${u.uc.registry.name} (${esc(u.uc.registry.issuers)})</p>
        <b>The app learns</b><p class="muted">${esc(u.uc.appLearns)}</p></div></div>
        <div class="row"><button class="ghost" data-ucissue="${i}" ${u.manka ? 'disabled' : ''}>1 Issue to Manka</button><button data-ucprove="${i}">2 Manka proves</button><button class="ghost" data-ucfail="${i}">Try: ${esc(u.uc.fail.who)}</button></div>
        ${u.result ? `<div class="result ${u.result.ok ? 'ok' : 'bad'}">${u.result.ok ? '✅' : '❌'} ${esc(u.result.text)}</div>` : ''}
        ${u.failText ? `<div class="result bad">${esc(u.failText)}<br><small>${esc(u.uc.fail.story)}</small></div>` : ''}
        <p class="muted">${u.reg.verifications} verified (billable) · <a href="https://github.com/mbanyadev/kola-id/blob/main/${u.uc.doc}" target="_blank" rel="noopener">use-case page</a></p></div>`).join('')}
      ${ucs.every((u) => u.nf) ? `<div class="card"><h3>Can the three apps link Manka?</h3><table>${ucs.map((u) => `<tr><td>${u.uc.app.name}</td><td class="mono">${short(u.nf!)}</td></tr>`).join('')}</table><p class="muted">Three different nullifiers. Even if Mboa Bet, Limbe Cocoa Buyers and Mboa Jobs pooled their databases, nothing joins.</p></div>` : ''}`;
    $('ucRun').addEventListener('click', () => { ucRunAll(); render(); });
    $('ucReset').addEventListener('click', () => { resetUseCases(); render(); });
    panel.querySelectorAll<HTMLButtonElement>('[data-ucissue]').forEach((b) => b.addEventListener('click', () => { ucIssue(ucs[Number(b.dataset.ucissue)]); render(); }));
    panel.querySelectorAll<HTMLButtonElement>('[data-ucprove]').forEach((b) => b.addEventListener('click', () => { ucProve(ucs[Number(b.dataset.ucprove)]); render(); }));
    panel.querySelectorAll<HTMLButtonElement>('[data-ucfail]').forEach((b) => b.addEventListener('click', () => { ucFail(ucs[Number(b.dataset.ucfail)]); render(); }));
  }
  if (tab === 'preview') {
    panel.innerHTML = '<div id="previewRoot"><div class="card"><p class="muted">Loading the Midnight Preview client…</p></div></div>';
    import('./preview.js')
      .then((m) => { const draw = () => { if (tab === 'preview' && $('previewRoot')) m.mount($('previewRoot'), log, draw); }; draw(); })
      .catch((e) => { $('previewRoot').innerHTML = `<div class="result bad">Could not load the Preview client: ${esc(String(e))}</div>`; });
  }
  $('tabs').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab as Tab; lastResult = null; render(); }));
}

function renderLedger() {
  if (tab === 'usecases') {
    $('ledger').innerHTML = ucs.map((u) => {
      const L = u.reg.sim.ledger;
      const nfs = [...L.nullifiers].map((n) => `<div class="mono">${short(n)}</div>`).join('') || '<span class="muted">none</span>';
      return `<div class="card"><b>${u.uc.registry.name}</b><table>
        <tr><th>issuers</th><td>${L.issuers.size()} approved key hash</td></tr>
        <tr><th>credentials</th><td>${L.issuedCount} commitment(s) · root <span class="mono">${short(L.credentials.root().field.toString(16).padStart(64, '0'))}</span></td></tr>
        <tr><th>policy</th><td>${u.uc.app.label}: ${u.reg.verifications} verification(s)</td></tr>
        <tr><th>nullifiers</th><td>${nfs}</td></tr></table></div>`;
    }).join('') + '<p class="muted">Three registries, all public. No name, birth date, member number, school or issuer-per-person anywhere.</p>';
    return;
  }
  const L = sim.ledger;
  const nfs = [...L.nullifiers].map((n) => `<div class="mono">${short(n)}</div>`).join('') || '<span class="muted">none</span>';
  const issuers = [...L.issuers].map((n) => `<div class="mono">${short(n)}</div>`).join('') || '<span class="muted">none</span>';
  const pol = [...L.policies].map(([id]) => `<div>${new TextDecoder().decode(id).replace(/\0+$/, '')}: ${L.verifications.lookup(id).read()} verifications</div>`).join('') || '<span class="muted">none</span>';
  const commits = holders.filter((h) => h.leaf && !h.revoked).map((h) => `<div class="mono">${short(h.leaf!)}</div>`).join('') || '<span class="muted">none</span>';
  $('ledger').innerHTML = `<div class="card"><table>
    <tr><th>admin</th><td class="mono">${short(L.admin)}</td></tr>
    <tr><th>issuers</th><td>${issuers}</td></tr>
    <tr><th>credentials</th><td>${L.issuedCount} issued, ${L.revokedCount} revoked · root <span class="mono">${short(L.credentials.root().field.toString(16).padStart(64, '0'))}</span><br>active commitments:${commits}</td></tr>
    <tr><th>policies</th><td>${pol}</td></tr>
    <tr><th>nullifiers</th><td>${nfs}</td></tr></table>
    <p class="muted">No names, birth dates, countries or issuer-per-person anywhere above.</p></div>`;
}

function render() { renderSteps(); renderPanel(); renderLedger(); }

$('mode').innerHTML = `<b>Local simulator mode.</b> The real compiled Kola ID circuits run in your browser against a local ledger. Open <b>Lace / Preview</b> to see the Kola ID reference deployment on Midnight Preprod, or to deploy your own on Preview with Lace.`;
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
  if (!t) return; const i = Number(t.dataset.step); tab = STEPS[i].tab; STEPS[i].run(); done.add(i); render();
});
$('runAll').addEventListener('click', () => { reset(); STEPS.forEach((s, i) => { s.run(); done.add(i); }); tab = 'apps'; render(); });
$('reset').addEventListener('click', () => { reset(); tab = 'admin'; render(); });
reset();
if (location.hash.startsWith('#beyond-finance')) { tab = 'usecases'; if (location.hash === '#beyond-finance-run') ucRunAll(); }
render();
