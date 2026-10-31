// End-to-end check of the demo UI in a real browser.
//   npm run demo:build && npx vite preview apps/demo --port 4317 &
//   node scripts/e2e-story.mjs [--url http://localhost:4317/] [--shots docs/preview-redesign/raw]
// Needs playwright-core (or set PW_CORE to its path) and Chrome (CHROME, default /usr/bin/google-chrome).
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://localhost:4317/');
const SHOTS = arg('--shots', '');
const { chromium } = await import(process.env.PW_CORE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
if (SHOTS) (await import('node:fs')).mkdirSync(SHOTS, { recursive: true });

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg); } else { failures++; console.log('  ✗', msg); } };

// Horizontal overflow: the page must not scroll sideways, and no visible element may stick out of the
// viewport unless an ancestor clips it on purpose (decorative bubbles). Also flags clipped single-line text.
async function layoutProblems(p) {
  return p.evaluate(() => {
    const W = document.documentElement.clientWidth; const out = [];
    if (document.documentElement.scrollWidth > W) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
    const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if ((r.right > W + 1 || r.left < -1) && !clipped(el) && cs.position !== 'fixed') out.push(`sticks out: ${el.tagName}.${el.className} [${Math.round(r.left)},${Math.round(r.right)}]`);
      if (el.children.length === 0 && el.textContent.trim() && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`clipped text: "${el.textContent.trim().slice(0, 40)}"`);
    }
    return [...new Set(out)].slice(0, 8);
  });
}

async function open(size) {
  const [w, h] = size === 'desktop' ? [1440, 900] : [390, 844];
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: size === 'desktop' ? 1 : 2 });
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(BASE); await p.waitForSelector('#steps');
  return p;
}
const shot = async (p, name) => { if (SHOTS) await p.waitForTimeout(400), await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const toStory = (p) => p.evaluate(() => { location.hash = '#story'; });
const attr = (p, sel, a) => p.getAttribute(sel, a);
const outcome = async (p) => { await p.waitForSelector('.outcome', { timeout: 5000 }); return { kind: await attr(p, '.outcome', 'data-outcome'), title: await attr(p, '.outcome', 'data-title') }; };

async function story(size) {
  console.log(`\n[${size}] the 8-step story, one step at a time`);
  const p = await open(size); const tag = size[0];
  await shot(p, `${tag}-01-hub`);
  const step = async (i) => { await toStory(p); await p.waitForSelector('#steps'); await p.click(`[data-act=step][data-step="${i}"]`); await p.waitForTimeout(150); };
  await step(0);
  ok(await attr(p, '[data-issuer="Kumba Verify"]', 'data-status') === 'approved', '1. registry admin approves Kumba Verify');
  await shot(p, `${tag}-02-registry`);
  await step(1);
  ok(await p.locator('[data-person="Manka"]').innerText().then((t) => /Issued/.test(t)) && await p.locator('[data-person="Ebai"]').innerText().then((t) => /Issued/.test(t)), '2. Manka and Ebai hold credentials');
  await shot(p, `${tag}-03-issuer`);
  await step(2);
  ok((await p.locator('[data-appcard]').allInnerTexts()).every((t) => /Live/.test(t)), '3. both apps published their rules');
  await shot(p, `${tag}-04-apps`);
  await step(3);
  let o = await outcome(p); ok(o.kind === 'success' && o.title === "You're in", `4. Manka joins Sawa Exchange (${o.title})`);
  await shot(p, `${tag}-05-success`);
  await step(4);
  o = await outcome(p); ok(o.kind === 'blocked' && o.title === 'Already joined', `5. second Sawa account is blocked (${o.title})`);
  await shot(p, `${tag}-06-blocked`);
  await step(5);
  o = await outcome(p); ok(o.kind === 'success', '6. Manka joins Ndole Games');
  const nfs = await p.locator('.signed .chip').allInnerTexts().catch(() => []);
  await step(6);
  o = await outcome(p); ok(o.kind === 'denied' && o.title === 'Not eligible', `7. Ebai (17) is denied at Sawa (${o.title})`);
  ok(/too young|age/i.test(await p.locator('.outcome').innerText()), '7. denial says why without revealing the age');
  await shot(p, `${tag}-07-denied`);
  await step(7);
  const ev = await p.locator('.card', { hasText: 'Revocations and re-issues' }).innerText().catch(async () => p.locator('main').innerText());
  ok(/Revoked Manka/.test(ev) && /refused Manka's login: credential revoked/.test(ev) && /Re-issued/.test(ev) && /logged back in/.test(ev), '8. revoke → login refused → re-issue → login works');
  await toStory(p); await p.waitForSelector('#steps');
  const states = await p.locator('[data-act=step]').evaluateAll((els) => els.map((e) => e.dataset.state));
  ok(states.length === 8 && states.every((s) => s === 'done'), `all 8 steps done (${states.join(',')})`);
  await shot(p, `${tag}-08-story-done`);
  ok(nfs.length === 2 && nfs[0] !== nfs[1], `per-app anonymous IDs differ (${nfs.join(' vs ')})`);
  // ledger drawer
  await p.click(size === 'desktop' ? '.topbar [data-act=ledger]' : '.bnav [data-act=ledger]');
  await p.waitForSelector('#ledger');
  const led = await p.locator('#ledger').innerText();
  ok(await p.locator('#log .tl').count() > 5 && /root|nullifier/i.test(led), 'ledger drawer opens with the public state and activity');
  await shot(p, `${tag}-09-ledger`);
  await p.keyboard.press('Escape');
  ok(await p.locator('#ledger').count() === 0 || !(await p.locator('#ledger').isVisible()), 'Escape closes the ledger');
  ok(p.errors.length === 0, `no page errors ${p.errors.join(' | ')}`);
  await p.close();
}

async function byHand(size) {
  console.log(`\n[${size}] the same flows by hand in the wallet`);
  const p = await open(size); const tag = size[0];
  await p.click('[data-act=step][data-step="2"]'); // approve issuer, issue, publish rules
  await p.evaluate(() => { location.hash = '#wallet'; }); await p.waitForSelector('[data-screen=wallet]');
  await shot(p, `${tag}-10-wallet`);
  const sheet = async (appName) => {
    if (size === 'desktop') await p.click(`[data-act=reqApp][data-app="${appName}"]`);
    else await p.click(`.m-req [data-act=review][data-app="${appName}"]`);
    await p.waitForSelector(`[data-sheet="${appName}"]`);
  };
  await sheet('Sawa Exchange');
  await shot(p, `${tag}-11-request`);
  await p.click('.wallet-r [data-act=prove]');
  ok(await p.locator('.proving').count() === 1, 'proving state shows while the proof is made');
  let o = await outcome(p); ok(o.kind === 'success', 'Approve and prove → You\'re in');
  await p.click('.outcome .btn-ghost[data-act=closeOutcome]');
  await sheet('Sawa Exchange'); await p.click('.wallet-r [data-act=prove]');
  o = await outcome(p); ok(o.kind === 'blocked', 'signing up twice is blocked');
  await p.click('.outcome [data-act=login]');
  await p.waitForSelector('.outcome[data-outcome=success]'); o = await outcome(p);
  ok(o.title === 'Welcome back', '"Log in instead" works with the same anonymous ID');
  await p.click('.outcome .btn-ghost[data-act=closeOutcome]');
  await p.click('[data-act=holder][data-holder="Ebai"]');
  ok(await attr(p, '[data-pass]', 'data-pass') === 'active', 'Ebai has an active pass');
  await sheet('Sawa Exchange'); await p.click('.wallet-r [data-act=prove]');
  o = await outcome(p); ok(o.kind === 'denied', 'Ebai "try anyway" is refused by the proof');
  await p.click('.outcome .btn-ghost[data-act=closeOutcome]');
  // revoke then re-issue from the issuer console
  await p.evaluate(() => { location.hash = '#issuer'; }); await p.waitForSelector('[data-person="Manka"]');
  await p.click('[data-person="Manka"] [data-act=revoke]');
  ok(/Revoked/.test(await p.locator('[data-person="Manka"]').innerText()), 'issuer revokes Manka');
  await p.evaluate(() => { location.hash = '#wallet'; }); await p.waitForSelector('[data-pass]');
  await p.click('[data-act=holder][data-holder="Manka"]');
  ok(await attr(p, '[data-pass]', 'data-pass') === 'revoked', 'wallet shows the pass as revoked');
  await sheet('Sawa Exchange'); await p.click('.wallet-r [data-act=login]');
  o = await outcome(p); ok(o.title === 'Credential revoked', `revoked login is refused (${o.title})`);
  await p.click('.outcome [data-act=tab][data-tab=issuer]'); await p.waitForSelector('[data-person="Manka"]');
  await p.click('[data-person="Manka"] [data-act=issue]');
  ok(/Issued/.test(await p.locator('[data-person="Manka"]').innerText()), 'issuer re-issues Manka');
  await p.evaluate(() => { location.hash = '#wallet'; }); await p.waitForSelector('[data-pass]');
  await sheet('Sawa Exchange'); await p.click('.wallet-r [data-act=login]');
  o = await outcome(p); ok(o.title === 'Welcome back', 'after re-issue the login works again');
  // a new person from the issuer form
  await p.evaluate(() => { location.hash = '#issuer'; }); await p.waitForSelector('#newHolder');
  await p.click('#newHolder summary'); await p.fill('#iName', 'Ngozi'); await p.click('[data-act=issueNew]');
  ok(await p.locator('[data-person="Ngozi"]').count() === 1, 'issuer form adds and issues a new person');
  ok(p.errors.length === 0, `no page errors ${p.errors.join(' | ')}`);
  await p.close();
}

async function beyond(size) {
  console.log(`\n[${size}] beyond finance`);
  const p = await open(size); const tag = size[0];
  await p.evaluate(() => { location.hash = '#beyond-finance'; }); await p.waitForSelector('#ucRun');
  await p.click('#ucRun'); await p.waitForSelector('[data-summary]');
  ok(await p.locator('[data-uc] .passed').count() === 3, 'Manka passes all three apps');
  ok(await p.locator('[data-fail=expected]').count() === 3, 'all three fail cases are refused for the right reason');
  const ids = await p.locator('[data-uc] .passed + .chip, [data-uc] .uc-status .chip').allInnerTexts();
  ok(new Set(ids).size === 3, `three unrelated anonymous IDs (${ids.join(', ')})`);
  await shot(p, `${tag}-12-beyond`);
  const q = await browser.newPage({ viewport: p.viewportSize() });
  await q.goto(BASE + '#beyond-finance-run'); await q.waitForSelector('[data-summary]');
  ok(await q.locator('[data-fail=expected]').count() === 3, '#beyond-finance-run runs on load');
  await q.close(); await p.close();
}

async function network(size) {
  console.log(`\n[${size}] network + Lace path`);
  const p = await browser.newPage({ viewport: size === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: size === 'desktop' ? 1 : 2 });
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(BASE + '#network'); await p.waitForSelector('#laceRoot [data-lace=none]');
  ok(true, 'without a wallet the Lace card says how to get one');
  ok(/d79be6ed/.test(await p.locator('main').innerText()) || await p.locator('[data-h^="d79be6ed"]').count() > 0, 'Preprod reference contract is shown');
  await shot(p, `${size[0]}-13-network`);
  await p.addInitScript(() => { window.midnight = { mnLace: { name: 'Lace', apiVersion: '4.0.1', connect: async () => { throw new Error('test wallet'); } } }; });
  await p.reload(); await p.waitForSelector('#pvConnect');
  ok(true, 'with a Midnight wallet present the Connect button appears');
  ok(p.errors.length === 0, `no page errors ${p.errors.join(' | ')}`);
  await p.close();
}

async function layout(size) {
  console.log(`\n[${size}] layout: no sideways scroll, nothing clipped`);
  const p = await open(size);
  await p.click('#runAll');
  for (const h of ['#story', '#wallet', '#apps', '#issuer', '#registry', '#beyond-finance-run', '#network']) {
    await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(400);
    const probs = await layoutProblems(p); ok(probs.length === 0, `${h} ${probs.join('; ')}`);
  }
  if (size === 'mobile') {
    await p.click('.bnav [data-act=more]'); await p.waitForSelector('.more-sheet');
    await shot(p, 'm-14-more'); ok(true, 'More sheet opens');
    await p.keyboard.press('Escape');
  }
  await p.close();
}

for (const s of ['desktop', 'mobile']) { await story(s); await byHand(s); await beyond(s); await network(s); await layout(s); }
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
