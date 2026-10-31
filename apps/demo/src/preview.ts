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
  const row = (k: string, v: string) => `<div class="prow"><span>${k}</span><span class="muted">${v}</span></div>`;
  return `<div class="onchain">
    ${row('Admin', `<code>${short(l.admin)}</code>`)}
    ${row('Issuers', l.issuers.map((i) => `<code>${short(i)}</code>`).join(' ') || 'none')}
    ${row('Credentials', `${l.credentialsIssued} issued, ${l.credentialsRevoked} revoked · root <code>${short(l.credentialRoot)}</code>`)}
    ${row('Apps', l.apps.map((a) => `${esc(a.appId)}: ${a.verifications} verified (≈${a.minAgeYearsApprox.toFixed(0)}+, epoch ${a.epoch})`).join('<br>') || 'none')}
    ${row('Nullifiers', String(l.nullifiers))}</div>`;
}

export function mount(root: HTMLElement, log: Log, rerender: () => void) {
  const wallets = findWallets();
  const steps = Object.entries(ref.steps ?? {});
  const busy = S.busy ? `<div class="msg"><span class="spin" style="width:14px;height:14px;border-width:2px;vertical-align:-2px"></span> ${esc(S.busy)}</div>` : '';
  // The Preprod reference deployment (deploy/preprod-deployment.json) is shown on the Network page itself, in main.ts.
  const res = (r?: { ok: boolean; text: string }) => r ? `<span class="pill ${r.ok ? 'ok' : 'bad'}">${esc(r.text)}</span>` : '<span class="muted">not run</span>';
  root.innerHTML = `
    ${ref.contractAddress ? `<div class="msg ok">Kola ID is live on Preview at <code>${short(ref.contractAddress)}</code> (block ${ref.deployBlock ?? '?'}).</div>
      ${steps.map(([, s]) => `<div class="prow"><span class="sdot ${s.ok ? '' : 'bad'}"></span><span>${esc(s.label)}</span><span class="muted">${s.ok ? `block ${s.block}` : `refused: ${esc(s.refused ?? '')}`}</span></div>`).join('')}
      <button class="btn-sec" id="pvRead">Read the live ledger from the Preview indexer</button>
      ${S.liveFor === ref.contractAddress && S.live ? ledgerTable(S.live) : ''}${S.liveErr ? `<div class="msg bad">${esc(S.liveErr)}</div>` : ''}` : ''}
    ${S.api ? `<div class="msg ok">Connected to ${esc(S.walletName ?? 'wallet')} as <code>${short(S.addr ?? '')}</code></div>`
      : `<p style="margin:0">Run the whole story as real transactions with your own wallet. You need Lace set to <b>Preview</b> with tDUST
          (get tNIGHT from the <a href="https://midnight-tmnight-preview.nethermind.dev/" target="_blank" rel="noopener">Preview faucet</a>) and a proof server in Lace's settings
          (local: <code>docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3</code>).</p>
        ${wallets.length ? `<label class="field">Private state password (16+ characters, stays in this browser)<input id="pvPw" type="password" autocomplete="new-password"></label>
          <button class="btn" id="pvConnect">Connect ${esc(wallets[0].name)}</button>`
        : '<div class="msg bad" data-lace="none">No Midnight wallet found in this browser. Install Lace, switch it to Preview, then reload.</div>'}`}
    ${S.api && !S.mine ? `<button class="btn" id="pvDeploy">Deploy my own Kola ID on Preview</button>
      <div class="msg">Your browser plays every role (admin, Kumba Verify, the apps, Manka and Ebai), each with its own secret. Every step is a real transaction you approve in Lace.</div>` : ''}
    ${S.mine ? `<div class="msg ok">Your contract: <code>${esc(S.mine.address)}</code></div>
      ${CHAIN_STEP_LIST.map((s, i) => `<div class="prow"><span>${i + 1}. ${esc(s.label)}</span><span class="muted">${res(S.mine!.results[s.id])}</span>
        <button class="btn-ghost" data-pv="${s.id}" style="height:34px">Run</button></div>`).join('')}
      <button class="btn-sec" id="pvLive">Read my contract's public ledger</button>
      ${S.liveFor === S.mine.address && S.live ? ledgerTable(S.live) : ''}` : ''}
    ${busy}`;

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
