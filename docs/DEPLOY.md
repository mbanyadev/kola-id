# Running Kola ID on Midnight Preview or Preprod

Two ways to use the real network:

* **Reference deployment (no wallet needed to look):** `deploy/preview-deployment.json` records the contract
  address, the deploy transaction and every story step that ran on Preview. The demo's **Lace / Preview** tab reads
  that contract's public ledger live from the Preview indexer.
* **Your own deployment from the browser:** in the **Lace / Preview** tab, connect Lace (set to Preview, holding
  tDUST), deploy your own Kola ID and run the story step by step. Each step is a transaction you approve in Lace.

## Deploying from Node.js (what produced the reference deployment)

Requirements: Node.js **22.12+** (the wallet SDK needs it), Docker, the compiled contract (`npm run compile`).

```bash
# 1. Proof server 8.1.3 (the version the support matrix lists for Preview)
docker run -d --name proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.1.3
curl http://127.0.0.1:6300/version            # 8.1.3

# 2. Throwaway Preview wallet. The recovery phrase is written to private/ (mode 600, gitignored) and never printed.
npm run preview:wallet                       # prints the mn_addr_preview1... address and balances
#    The first sync of a new wallet reads the whole Preview history (about 20 minutes); later runs resume
#    from the saved state in private/.

# 3. Fund it: request tNIGHT at https://midnight-tmnight-preview.nethermind.dev/ (Cloudflare Turnstile captcha,
#    so this step is done in a browser by a person).

# 4. Deploy and run the story on-chain
npm run preview:deploy
```

`preview:deploy` registers the wallet's tNIGHT for DUST generation, waits for tDUST, deploys Kola ID, then runs
the story (`CHAIN_STEPS` in `sdk/src/chain.ts`): approve Kumba Verify, issue credentials to Manka and Ebai, publish
the Sawa Exchange and Ndole Games policies, Manka signs up to both apps, and Manka logs back in. Two steps are
*supposed* to fail and are refused by the local proof before anything is sent (no fee): Manka's second Sawa
account (sybil) and Ebai's sign-up (under 18). The script is resumable: it records every completed step in
`deploy/preview-deployment.json` and skips it next time.

On Preview one wallet pays the fees for every role, but each role still has its own secret (admin, issuer, apps,
holders), kept in `private/demo-cast-preview.json`. In production each party runs its own wallet.

The same story runs offline in `tests/chain-steps.test.ts` against the simulator, so the role switching and
expected outcomes are tested before any tDUST is spent.

## Preprod

The same scripts target Preprod with `--network=preprod`:

```bash
npm run preprod:wallet     # mn_addr_preprod1... address (same throwaway phrase as Preview) and balances
npm run preprod:deploy     # writes deploy/preprod-deployment.json
```

Since 9 October 2026 the public Preprod indexer and node RPC are served by Blockfrost (the Midnight-hosted
`indexer.preprod.midnight.network` now returns HTTP 410). Every Preprod request needs a free Blockfrost project
token for the **Midnight Preprod** network (it starts with `nightpreprod`). Put it in
`private/blockfrost-preprod.token` (chmod 600, gitignored) or in `BLOCKFROST_PROJECT_ID`. The scripts add it as
`?project_id=...`, check it against the indexer before syncing (a bad token fails with Blockfrost's own message), and
redact it from all output, including URLs that libraries log on their own. `npm run preprod:wallet -- --address-only` works without a token.

The proof server is the same 8.1.3 image for both networks (support matrix).

### Reference deployment on Preprod (27 October 2026)

| | |
|---|---|
| Contract | [`d79be6ed9ae73874daa10a1e9e3b36f8772a5d7eb7991f18af1b8975c9027be3`](https://preprod.midnightexplorer.com/contracts/d79be6ed9ae73874daa10a1e9e3b36f8772a5d7eb7991f18af1b8975c9027be3) |
| Deployed | block [3,163,444](https://preprod.midnightexplorer.com/blocks/3163444), 15:42 UTC, from `npm run preprod:deploy` |
| Story on-chain | 7 transactions landed (blocks 3,163,568 to 3,163,603); the second Sawa Exchange account and Ebai (17) were refused by the proof, as intended |
| Record | [`deploy/preprod-deployment.json`](../deploy/preprod-deployment.json): every step, transaction identifier and block |

The wallet was funded from the Nethermind Preprod faucet (https://midnight-tmnight-preprod.nethermind.dev/), and
its 5,000 tNIGHT were registered for DUST generation by the script. The first sync of a new wallet on Preprod
reads about 1.76 million shielded and DUST events and took about 3 h 45 min; the scripts now checkpoint the wallet
state every 2 minutes, so an interrupted sync resumes. The explorer indexes transactions by hash, so look a step up
by its block. Run the scripts with **Node 22** (the wallet SDK uses iterator helpers that Node 20 lacks).

## Endpoints

| Service | Preview | Preprod (`?project_id=<token>` on each) |
|---|---|---|
| Node RPC | `https://rpc.preview.midnight.network` | `https://rpc.midnight-preprod.blockfrost.io` |
| Indexer | `https://indexer.preview.midnight.network/api/v4/graphql` | `https://midnight-preprod.blockfrost.io/api/v0` |
| Indexer ws | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` | `wss://midnight-preprod.blockfrost.io/api/v0/ws` |
| Proof server | local 8.1.3, `http://127.0.0.1:6300` | local 8.1.3, `http://127.0.0.1:6300` |
| Faucet | https://midnight-tmnight-preview.nethermind.dev/ | https://faucet.preprod.midnight.network/ |
| Explorer | https://preview.midnightexplorer.com/ | https://preprod.midnightexplorer.com/ |

Override with `INDEXER_HTTP`, `INDEXER_WS`, `NODE_RPC`, `PROOF_SERVER`; keep secrets elsewhere with `KOLA_PRIVATE_DIR`.

## What is never committed

`private/` (recovery phrase, wallet state, demo-role secrets, private-state password, LevelDB store, Blockfrost token), `*.token`,
`contracts/managed/` (build output), `apps/demo/public/zk/` (copied keys). See `.gitignore`.
