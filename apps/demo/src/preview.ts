// SPDX-License-Identifier: Apache-2.0
// "Lace / Preview" mode: the same Kola ID contract on the Midnight Preview network.
//  * Reads the reference deployment's public ledger straight from the Preview indexer (no wallet).
//  * With Lace on Preview, deploys your own Kola ID and runs the guided story as real transactions:
//    proofs are generated through Lace's proof server and every fee is paid in tDUST from your wallet.
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../../../contracts/managed/kola-id/contract/index.js';
import { summarizeLedger, todayUtc, type DemoCast, type KolaContract, type KolaProviders } from '../../../sdk/src/chain.js';
import deployment from '../../../deploy/preview-deployment.json';

export const NETWORK_ID = 'preview';
export const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
export const INDEXER_WS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
setNetworkId(NETWORK_ID);

type Dep = { contractAddress?: string; deployTxId?: string; deployBlock?: number; deployedAt?: string;
  steps: Record<string, { label: string; ok: boolean; txId?: string; block?: number; refused?: string }> };
const ref = deployment as Dep;

type Log = (t: string, kind?: 'ok' | 'bad' | '') => void;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const short = (h: string) => (h.length > 20 ? h.slice(0, 10) + '…' + h.slice(-6) : h);

const S: {
  live?: ReturnType<typeof summarizeLedger> | null; liveErr?: string; liveFor?: string;
  api?: ConnectedAPI; walletName?: string; addr?: string; providers?: KolaProviders;
  mine?: { address: string; contract: KolaContract; cast: DemoCast; results: Record<string, { ok: boolean; text: string }> };
  busy?: string;
} = {};

export const findWallets = (): InitialAPI[] =>
  Object.values((window as unknown as { midnight?: Record<string, InitialAPI> }).midnight ?? {}).filter(
    (w) => typeof w?.connect === 'function' && String(w.apiVersion).startsWith('4.'));

async function readLive(address: string) {
  S.liveFor = address; S.liveErr = undefined;
  try {
    const pdp = indexerPublicDataProvider(INDEXER, INDEXER_WS);
    const cs = await pdp.queryContractState(address);
    S.live = cs ? summarizeLedger(ledger(cs.data)) : null;
    if (!cs) S.liveErr = 'The indexer has no contract at this address.';
  } catch (e) { S.liveErr = (e as Error).message; }
}

function ledgerTable(l: NonNullable<typeof S.live>) {
  return `<table>
    <tr><th>admin</th><td class="mono">${short(l.admin)}</td></tr>
    <tr><th>issuers</th><td>${l.issuers.map((i) => `<div class="mono">${short(i)}</div>`).join('') || '<span class="muted">none</span>'}</td></tr>
    <tr><th>credentials</th><td>${l.credentialsIssued} issued, ${l.credentialsRevoked} revoked · root <span class="mono">${short(l.credentialRoot)}</span></td></tr>
    <tr><th>apps</th><td>${l.apps.map((a) => `<div>${esc(a.appId)}: ${a.verifications} verifications (18+ ≈ ${a.minAgeYearsApprox.toFixed(0)}y, epoch ${a.epoch})</div>`).join('') || '<span class="muted">none</span>'}</td></tr>
    <tr><th>nullifiers</th><td>${l.nullifiers}</td></tr></table>`;
}

export function mount(root: HTMLElement, log: Log, rerender: () => void) {
  const wallets = findWallets();
  const steps = Object.entries(ref.steps ?? {});
  const busy = S.busy ? `<p class="muted">⏳ ${esc(S.busy)}</p>` : '';
  root.innerHTML = `
    <div class="card"><span class="tag">Midnight Preview · reference deployment</span>
      ${ref.contractAddress ? `<h3>Kola ID is live on Preview</h3>
        <p>Contract <span class="mono">${ref.contractAddress}</span><br><span class="muted">deployed ${esc(ref.deployedAt ?? '')} in block ${ref.deployBlock ?? '?'} · tx <span class="mono">${short(ref.deployTxId ?? '')}</span></span></p>
        <table><tr><th>Story step on Preview</th><th>Result</th></tr>${steps.map(([, s]) => `<tr><td>${esc(s.label)}</td><td>${s.ok
          ? `✅ block ${s.block} · <span class="mono">${short(s.txId ?? '')}</span>` : `❌ refused by the proof: ${esc(s.refused ?? '')}`}</td></tr>`).join('')}</table>
        <div class="row"><button id="pvRead">Read the live public ledger from the Preview indexer</button></div>
        ${S.liveFor === ref.contractAddress && S.live ? ledgerTable(S.live) : ''}${S.liveErr ? `<div class="result bad">${esc(S.liveErr)}</div>` : ''}`
      : `<h3>Reference deployment pending</h3><p class="muted">The Preview deployment of Kola ID has not been published yet. You can still deploy your own below with Lace.</p>`}
    </div>
    <div class="card"><span class="tag">Your own Kola ID on Preview · Lace</span>
      ${S.api ? `<p>Connected to ${esc(S.walletName ?? 'wallet')} as <span class="mono">${short(S.addr ?? '')}</span></p>`
      : `<p class="muted">Needs the Lace wallet set to <b>Preview</b>, with tDUST (get tNIGHT from the
          <a href="https://midnight-tmnight-preview.nethermind.dev/" target="_blank" rel="noopener">Preview faucet</a> and let Lace generate tDUST),
          and a proof server in Lace's settings (local: <span class="mono">docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3</span>).</p>
        ${wallets.length ? `<div class="row"><label>Private state password (16+ chars, stays in this browser)<input id="pvPw" type="password" autocomplete="new-password"></label>
          <button id="pvConnect">Connect ${esc(wallets[0].name)}</button></div>`
        : '<div class="result bad">No Midnight wallet found in this browser. Install Lace and switch it to Preview, then reload.</div>'}`}
      ${S.api && !S.mine ? `<div class="row"><button id="pvDeploy">Deploy my own Kola ID on Preview</button></div>
        <p class="muted">Your browser plays every role (admin, Kumba Verify, the apps, Manka and Ebai), each with its own secret. Every step is a real transaction you approve in Lace.</p>` : ''}
      ${S.mine ? `<p>Your contract: <span class="mono">${S.mine.address}</span></p>
        <table><tr><th>Step</th><th></th><th>Result</th></tr>${CHAIN_STEP_LIST.map((s, i) => `<tr><td>${i + 1}. ${esc(s.label)}</td>
          <td><button class="ghost" data-pv="${s.id}">Run</button></td><td>${S.mine!.results[s.id] ? `${S.mine!.results[s.id].ok ? '✅' : '❌'} ${esc(S.mine!.results[s.id].text)}` : ''}</td></tr>`).join('')}</table>
        <div class="row"><button id="pvLive">Read my contract's public ledger</button></div>
        ${S.liveFor === S.mine.address && S.live ? ledgerTable(S.live) : ''}` : ''}
      ${busy}
    </div>`;

  const act = (id: string, label: string, fn: () => Promise<void>) => root.querySelector(`#${id}`)?.addEventListener('click', async () => {
    if (S.busy) return;
    S.busy = label; rerender();
    try { await fn(); } catch (e) { log(`${label}: ${(e as { reason?: string }).reason ?? (e as Error).message}`, 'bad'); }
    S.busy = undefined; rerender();
  });
  act('pvRead', 'Reading the Preview indexer', () => readLive(ref.contractAddress!));
  act('pvLive', 'Reading the Preview indexer', () => readLive(S.mine!.address));
  act('pvConnect', 'Connecting to Lace', async () => {
    const pw = (root.querySelector('#pvPw') as HTMLInputElement).value;
    const { connectLace } = await import('./lace.js');
    const r = await connectLace(wallets[0], pw, NETWORK_ID, INDEXER, INDEXER_WS);
    Object.assign(S, { api: r.api, providers: r.providers, addr: r.address, walletName: wallets[0].name });
    log(`Connected to ${wallets[0].name} on Preview`, 'ok');
  });
  act('pvDeploy', 'Deploying Kola ID to Preview (approve in Lace; proving can take a minute)', async () => {
    const { deployKola, newCast } = await import('../../../sdk/src/chain.js');
    const cast = newCast();
    const d = await deployKola(S.providers!, new URL('zk', location.href).pathname, cast);
    S.mine = { address: d.deployTxData.public.contractAddress, contract: d as unknown as KolaContract, cast, results: {} };
    log(`Kola ID deployed on Preview at ${S.mine.address}`, 'ok');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach((b) => b.addEventListener('click', async () => {
    if (S.busy || !S.mine) return;
    const step = CHAIN_STEP_LIST.find((s) => s.id === b.dataset.pv)!;
    S.busy = `${step.label} (approve in Lace)`; rerender();
    try {
      const r = (await step.run(S.mine.contract, S.providers!, S.mine.address, S.mine.cast, todayUtc())) as { public: { blockHeight: number; txId: string } };
      S.mine.results[step.id] = { ok: true, text: `landed in block ${r.public.blockHeight}` };
      log(`${step.label}: on-chain in block ${r.public.blockHeight}`, 'ok');
    } catch (e) {
      const m = (e as { reason?: string }).reason ?? (e as Error).message ?? String(e);
      const reason = /failed assert: (.*)/.exec(m)?.[1] ?? m.split('\n')[0];
      S.mine.results[step.id] = { ok: false, text: reason };
      log(`${step.label}: ${reason}`, 'bad');
    }
    S.busy = undefined; rerender();
  }));
}

import { CHAIN_STEPS as CHAIN_STEP_LIST } from '../../../sdk/src/chain.js';
