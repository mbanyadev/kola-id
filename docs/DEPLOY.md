# Running Kola ID on Midnight Preview

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

## Endpoints

| Service | URL |
|---|---|
| Node RPC | `https://rpc.preview.midnight.network` |
| Indexer | `https://indexer.preview.midnight.network/api/v4/graphql` (ws: `wss://indexer.preview.midnight.network/api/v4/graphql/ws`) |
| Proof server | local, `http://127.0.0.1:6300` |
| Faucet | https://midnight-tmnight-preview.nethermind.dev/ |
| Explorers | https://preview.midnightexplorer.com/ · https://midnight-preview.subscan.io/ |

Override with `INDEXER_HTTP`, `INDEXER_WS`, `NODE_RPC`, `PROOF_SERVER`; keep secrets elsewhere with `KOLA_PRIVATE_DIR`.

## What is never committed

`private/` (recovery phrase, wallet state, demo-role secrets, private-state password, LevelDB store),
`contracts/managed/` (build output), `apps/demo/public/zk/` (copied keys). See `.gitignore`.
