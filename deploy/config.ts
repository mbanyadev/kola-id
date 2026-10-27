// SPDX-License-Identifier: Apache-2.0
// Network configuration for the Kola ID deploy scripts. Imported first by every script.
//
// Pick the network with `--network=preprod` (the npm preprod:* scripts pass it) or MIDNIGHT_NETWORK.
// Endpoints follow docs.midnight.network "Networks and environments":
//  * preview: Midnight-hosted, no token.
//  * preprod: served by Blockfrost since the Midnight-hosted Preprod indexer/RPC were retired on
//    9 October 2026; every URL needs a Blockfrost "Midnight Preprod" project token (?project_id=...).
//    The token is read from BLOCKFROST_PROJECT_ID or private/blockfrost-preprod.token and is
//    redacted from everything these scripts print.
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fromArg = process.argv.find((a) => a.startsWith('--network='))?.split('=')[1];
export const NETWORK_ID = (fromArg ?? process.env.MIDNIGHT_NETWORK ?? 'preview').trim();

interface NetworkInfo {
  indexerHttpUrl: string;
  indexerWsUrl: string;
  node: string;
  faucet: string;
  explorer: string;
  /** Blockfrost-served networks need a project token on every indexer and RPC URL. */
  blockfrost: boolean;
}

export const NETWORKS: Record<string, NetworkInfo> = {
  preview: {
    indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
    explorer: 'https://preview.midnightexplorer.com/',
    blockfrost: false,
  },
  preprod: {
    indexerHttpUrl: 'https://midnight-preprod.blockfrost.io/api/v0',
    indexerWsUrl: 'wss://midnight-preprod.blockfrost.io/api/v0/ws',
    node: 'https://rpc.midnight-preprod.blockfrost.io',
    faucet: 'https://faucet.preprod.midnight.network/',
    explorer: 'https://preprod.midnightexplorer.com/',
    blockfrost: true,
  },
};

const net = NETWORKS[NETWORK_ID];
if (!net) throw new Error(`Unknown network "${NETWORK_ID}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
setNetworkId(NETWORK_ID);

/**
 * Directory for everything secret or wallet-specific: recovery phrase, wallet state, private-state
 * password, LevelDB store, Blockfrost token. It is gitignored and must stay outside version control.
 */
export const PRIVATE_DIR = resolve(process.env.KOLA_PRIVATE_DIR ?? new URL('../private', import.meta.url).pathname);
mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });

export const BLOCKFROST_TOKEN_FILE = join(PRIVATE_DIR, `blockfrost-${NETWORK_ID}.token`);
let token: string | undefined;
const projectId = (): string => {
  token ??= (process.env.BLOCKFROST_PROJECT_ID ?? (existsSync(BLOCKFROST_TOKEN_FILE) ? readFileSync(BLOCKFROST_TOKEN_FILE, 'utf8') : '')).trim();
  if (!token) {
    throw new Error(
      `${NETWORK_ID} is served by Blockfrost and needs a "Midnight ${NETWORK_ID}" project token. ` +
        `Put it in ${BLOCKFROST_TOKEN_FILE} (chmod 600) or BLOCKFROST_PROJECT_ID.`,
    );
  }
  if (!token.startsWith(`night${NETWORK_ID}`)) throw new Error(`The Blockfrost token is not a Midnight ${NETWORK_ID} project ID (it should start with "night${NETWORK_ID}").`);
  return token;
};
const withToken = (url: string): string =>
  net.blockfrost ? `${url}${url.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(projectId())}` : url;

/** Remove the Blockfrost token from anything before it is printed. */
export const redact = (s: string): string => {
  let out = s.replace(/project_id=[^&\s"']+/g, 'project_id=<redacted>');
  if (token) out = out.split(token).join('<redacted>');
  return out;
};
// Libraries log URLs on their own (the Polkadot RPC client prints the full WebSocket URL on reconnect),
// so every console method and direct stdout/stderr write is redacted too.
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => orig(...args.map((a) => (typeof a === 'string' ? redact(a) : a instanceof Error ? redact(a.stack ?? a.message) : a)));
}
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) =>
    write(typeof chunk === 'string' ? redact(chunk) : Buffer.isBuffer(chunk) ? redact(chunk.toString()) : chunk, ...rest)) as typeof stream.write;
}
const fail = (e: unknown) => {
  console.error(redact(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

/** Endpoints, built when first used so a missing token only matters to scripts that go online. */
export const CONFIG = {
  get indexerHttpUrl() { return process.env.INDEXER_HTTP ?? withToken(net.indexerHttpUrl); },
  get indexerWsUrl() { return process.env.INDEXER_WS ?? withToken(net.indexerWsUrl); },
  get node() { return process.env.NODE_RPC ?? withToken(net.node); },
  proofServer: process.env.PROOF_SERVER ?? 'http://127.0.0.1:6300',
  faucet: net.faucet,
  explorer: net.explorer,
};

export const CONTRACT_DIR = new URL('../contracts/managed/kola-id', import.meta.url).pathname;
/** Public record of the deployment on this network (committed; no secrets). */
export const DEPLOYMENT_FILE = new URL(`./${NETWORK_ID}-deployment.json`, import.meta.url).pathname;

/** Fail fast with the indexer's own message (for example Blockfrost's 403 reason) instead of an opaque sync error. */
export async function checkIndexer(): Promise<number> {
  const res = await fetch(CONFIG.indexerHttpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ block { height } }' }),
  }).catch((e: Error) => { throw new Error(redact(`Indexer for ${NETWORK_ID} unreachable: ${e.message}`)); });
  const text = await res.text();
  const height = (() => { try { return JSON.parse(text)?.data?.block?.height as number | undefined; } catch { return undefined; } })();
  if (!res.ok || height === undefined) throw new Error(redact(`Indexer for ${NETWORK_ID} answered HTTP ${res.status}: ${text.slice(0, 300)}`));
  return height;
}
