# Kola ID

**Verify once. Prove anywhere. Stay unlinkable.**

Kola ID is a reusable, private identity layer on [Midnight](https://midnight.network). An approved
issuer (a KYC provider, bank or mobile-money operator) checks a person once and writes a *hiding
commitment* to their credential on-chain. From then on, the person proves to any app, in zero
knowledge, only what that app asks: **over 18**, **resident in an allowed country**, **sanctions
screening clear and recent**. The app gets one yes/no and a per-app nullifier. It never sees a name,
birth date, country, document or even which issuer verified the person, and two apps cannot link the
same person.

**Live demo:** https://mbanyadev.github.io/kola-id/ (simulator mode in your browser, plus a **Lace / Preview** mode on the real network; see [Demo](#demo)). New this wave: the [**Beyond finance**](https://mbanyadev.github.io/kola-id/#beyond-finance) tab, where one person passes a betting app, a cocoa buyer and a job platform.

**Pitch deck:** [docs/Kola-ID-deck.pdf](docs/Kola-ID-deck.pdf) · **Demo video (3 min, captioned):** [docs/media/kola-id-demo.mp4](docs/media/kola-id-demo.mp4) ([direct download](https://github.com/mbanyadev/kola-id/raw/main/docs/media/kola-id-demo.mp4)) · **Business case:** [docs/BUSINESS.md](docs/BUSINESS.md) · **Use cases:** [docs/use-cases](docs/use-cases/README.md)

**Live on Midnight Preprod:** contract [`d79be6ed9ae7…027be3`](https://preprod.midnightexplorer.com/contracts/d79be6ed9ae73874daa10a1e9e3b36f8772a5d7eb7991f18af1b8975c9027be3), deployed 27 Oct 2026 with the story run on-chain (record in [`deploy/preprod-deployment.json`](deploy/preprod-deployment.json), details in [docs/DEPLOY.md](docs/DEPLOY.md#reference-deployment-on-preprod-27-october-2026))

| | |
|---|---|
| Contract | [`contracts/src/kola-id.compact`](contracts/src/kola-id.compact): 7 proving circuits + 6 pure helpers |
| Toolchain | Compact compiler **0.31.1** (language 0.23), compact-runtime 0.16.0, ledger 8: the versions the [support matrix](https://docs.midnight.network/relnotes/support-matrix) lists for Preview, Preprod and Mainnet |
| Tests | 43 tests, all passing (`npm test`): 30 contract tests, the on-chain story checked offline, and 11 tests for the three non-finance registries |
| Network | Midnight **Preprod** (reference deployment) and **Preview**: proof server 8.1.3, Midnight.js 4.1.1, wallet SDK 1.2.0, DApp Connector 4.0.1 |
| License | Apache-2.0 |

## Why

Every regulated or age-gated app re-verifies the same person: upload an ID, take a selfie, wait. Users
drop off, apps pay per check, and every app ends up storing a copy of the documents. Existing "reusable
KYC" removes the repetition but adds a central provider that sees every app a person uses, plus a shared
identifier apps can join on. The facts apps actually need are yes/no. Midnight lets us prove them
without revealing the data, and without a shared identifier.

## How it works

```
 Issuer (Kumba Verify) ──issueCredential(commitment)──┐
                                                      ▼
 Holder wallet ──proveForApp(appId, today)──►  Kola ID contract (Midnight)
   private state: attributes, salt,              public ledger: approved issuer keys,
   holder secret, Merkle path                    credential commitments (Merkle tree),
                                                 app policies, nullifiers, per-app counters
 Relying app (Sawa Exchange) ◄── reads its nullifier + counter from the ledger / indexer
 Proofs are generated locally (proof server); private inputs never leave the holder's device.
```

1. **Issuer registry.** The admin approves issuer keys (`addIssuer` / `removeIssuer`). Admin, issuer and
   app keys are domain-separated hashes of secrets that stay in each party's private state.
2. **Issuance.** An approved issuer calls `issueCredential(leaf)` where
   `leaf = persistentCommit(Credential, salt)`. The credential (holder key, issuer key, birth day,
   country, sanctions result and date, expiry) goes to the holder; only the commitment goes on-chain,
   into a depth-20 `HistoricMerkleTree` (about 1M credentials).
3. **App policy.** An app publishes its policy with `setPolicy`: minimum age, up to 8 allowed countries,
   whether sanctions screening is required and how fresh it must be, and an epoch. Policies are public,
   so users see exactly what is checked.
4. **Proof.** `proveForApp(appId, today)` checks, all on private witness data:
   * `today` matches block time (`blockTimeGte` / `blockTimeLt`, one day of slack), so nobody back-dates
     a proof to dodge expiry or screening freshness;
   * the caller knows the holder secret behind the credential, and the credential's commitment is in
     the tree under a currently valid root (`checkRoot(merkleTreePathRoot(path))`);
   * not expired; old enough; country in the allow-list; sanctions screening clear and recent.

   It then discloses only `nullifier = persistentHash(appId, epoch, holderSecret)`, rejects it if already
   used (one account per person per app and epoch), stores it and increments the app's billing counter.
   `proveReturning` is the login variant: same checks, and the nullifier must already exist.
5. **Revocation.** The issuer opens its own commitment privately in `revokeCredential`, zeroes that slot
   (`insertIndexDefault`) and calls `resetHistory()`, so every old root and every proof against it stops
   verifying. Proofs never reveal the leaf or its index, so a revocation can't be joined to any app's
   records. Holders simply refresh their Merkle path.

### What is private and what is public

| Data | Visibility |
|---|---|
| Name, documents, selfie | Never touch Midnight (stay in the issuer's KYC system) |
| Birth day, country, sanctions result and date, expiry, salt, holder secret | **Private**: witness data, used only inside proofs |
| Which issuer verified a given person | **Private** at proof time (inside the commitment) |
| Credential commitment and its tree slot | Public at issuance, but hiding; never shown at proof time |
| Approved issuer keys, app policies | Public (accountable parties; transparent rules) |
| Per-app nullifier, verification count | Public; nullifiers differ per app, so apps can't link users |

The test suite checks this directly: it inspects the public transcript of a proof and asserts that the
holder key, commitment, salt, secret and issuer key never appear in it.

## Midnight integration

* **Compact contract** with private witnesses (`holderSecret`, `credential`, `credentialSalt`,
  `credentialPath`, plus admin/issuer/app secrets) and explicit `disclose()` only where a value is
  meant to become public. Uses `HistoricMerkleTree` (`insert`, `checkRoot`, `insertIndexDefault`,
  `resetHistory`), `persistentCommit`, `persistentHash`, `merkleTreePathRoot`, `blockTimeGte/Lt`,
  `Set`, `Map` of `Counter`, `map`/`fold` over vectors.
* **Dual-ledger model:** attributes and secrets live in each party's private state; the public ledger
  holds only commitments, policies, nullifiers and counters.
* **TypeScript SDK** (`sdk/src`): witness implementations that answer from private state (the Merkle path
  is looked up from the projected ledger with `findPathForLeaf`), credential and policy builders, date
  helpers, and an in-process simulator built on `@midnight-ntwrk/compact-runtime` 0.16.0.
* Bytes keys (not `Field`) for every Set/Map used as a one-time guard.

## Repository layout

```
contracts/src/kola-id.compact   the contract
sdk/src/                        witnesses, builders, simulator, Midnight.js glue (chain.ts)
deploy/                         Preview/Preprod wallet + deploy script (Node 22), public deployment records
sdk/src/use-cases.ts            the three "beyond finance" presets (policies, issuers, fail cases)
tests/                          Vitest simulator tests
apps/demo/                      web demo (Vite, no framework), deployed to GitHub Pages
docs/                           design, business case, use cases, 0.31.1 compatibility notes, threat model
docs/Kola-ID-deck.pdf           pitch deck (source in docs/deck/)
docs/media/                     demo video and its captions (.srt)
```

## Setup

Requirements: Node.js 20+ and the Compact devtools.

```bash
# Compact devtools + the 0.31.1 compiler
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1
compact compile --version          # 0.31.1

npm install
npm run compile                     # compact compile → contracts/managed/kola-id (circuits, ZK keys, JS)
npm test                            # 43 tests
npm run typecheck
npm run demo:dev                    # http://localhost:5173
```

`npm run compile:fast` skips proving-key generation for quicker iteration.

## How to test / evaluate

* `npm test` runs every circuit through the compiled contract with the Compact runtime simulator. It
  covers: admin-only registry changes; unapproved and removed issuers; policy ownership; the happy path;
  duplicate sign-up; returning login; different nullifiers per app; epoch reset; too young (with exact
  boundary days and a leap-year check of the conservative age rule); country allow-list and "any
  country"; sanctions hit, stale screening (90/91 days) and future-dated screening; expiry; a stolen
  credential without the holder secret; a mismatched Merkle path; a never-issued credential; `today`
  in the future or stale against block time; revocation (old paths and old roots rejected, re-issue
  works and does not allow a second account); revoking exactly the right slot among many; only the
  issuing issuer can revoke; and what appears in the public transcript.
* `tests/use-cases.test.ts` runs the three non-finance registries: each pass case, each refusal
  (under 21 at a betting app, lapsed co-op membership, an unaccredited "diploma mill" issuer, an
  expired licence), three different nullifiers for one person across three apps, and that an issuer
  approved in one registry cannot issue into another.
* Mutation check: flipping the slot-index direction or deleting the root check in the contract makes
  the revocation tests fail, so they test the contract, not the fixture.
* Open the [demo](https://mbanyadev.github.io/kola-id/) and press the guided steps 1 to 8, then open
  **Beyond finance** and press **Run: Manka passes three apps**.

## Demo

The web demo has four views (registry admin, issuer "Kumba Verify", holder wallet, apps "Sawa Exchange"
and "Ndole Games") and a live view of the public ledger. In **local simulator mode** it runs the real
compiled Kola ID circuits in the browser, against a local ledger, so anyone can try it without a wallet.
The guided steps follow the story: approve the issuer, issue to Manka (adult) and Ebai (17), publish
policies, Manka signs up (✅), tries again (❌ already registered), signs up to a second app (✅, a
different nullifier), Ebai is rejected (❌ too young), the issuer revokes Manka (❌), re-issues, and she
logs back in (✅). All names are fictional.

### Beyond finance

The **Beyond finance** tab runs the same contract, unchanged, as three separate registries (one Kola ID
deployment per trust domain, each approving only its own kind of issuer):

| App (fictional) | Issuer (fictional) | Public policy |
|---|---|---|
| **Mboa Bet**, online betting | Kumba Verify (KYC registry) | 21+ (Cameroon's civil majority), Cameroon, one account per person |
| **Limbe Cocoa Buyers**, cocoa buyer | Fako Cocoa Farmers Union (Co-op registry) | current member, good standing re-checked within 365 days, adult, Cameroon |
| **Mboa Jobs**, job platform | Buea Technical Institute (Skills registry) | certificate authenticated within 2 years, not expired, adult |

Manka passes all three with three unlinkable nullifiers; Ebai (19) fails the 21+ check, Tabe's lapsed
membership fails, and an unaccredited "Quick Diploma Centre" cannot issue at all. In these registries the
contract's screening pair (`sanctionsClear`, `screenedDay`) means "the issuer's check passed, on this
day". The pages in [docs/use-cases](docs/use-cases/README.md) give each policy and the regulation behind
it. These presets run in the in-browser simulator; only the KYC registry is deployed on Preprod so far.

The **Lace / Preview** tab is the same app on the real network. It shows the reference deployment on Midnight
Preprod ([contract](https://preprod.midnightexplorer.com/contracts/d79be6ed9ae73874daa10a1e9e3b36f8772a5d7eb7991f18af1b8975c9027be3), every story transaction with its block on the explorer). Preprod's indexer is
served by Blockfrost and needs a private token, so the page links to the explorer rather than querying Preprod from
your browser. With
Lace set to Preview you can deploy your own Kola ID from the page and run the story as real transactions: proofs
come from your proof server through Lace, fees are paid in tDUST, and private state is encrypted in your browser.

Deploying from Node.js (`npm run preprod:wallet`, `npm run preprod:deploy`, or the `preview:` equivalents) and the endpoints are in
[docs/DEPLOY.md](docs/DEPLOY.md).

## Business model

Full business case with sources: [docs/BUSINESS.md](docs/BUSINESS.md). Kola ID is an early product: no
customers, signed issuers or revenue yet, so everything here is a proposal.

* **Buyers:** mobile-money agent networks, exchanges and lending apps in Cameroon and CEMAC that must
  identify every customer (Cameroon alone had 31.0 M mobile-money accounts at end-2024, per the BEAC),
  then betting operators, commodity buyers and job platforms.
* **Pricing (proposed):** the app pays per successful proof, 150 FCFA (≈ €0.23) per sign-up and 10 FCFA per
  returning login, with no monthly minimum; the first 1,000 proofs per app are free. Successful proofs are
  counted on-chain per app. 40% goes to the issuer whose credential was reused. For comparison, a fresh
  check lists at US$1.35 on Sumsub Basic and US$1.00 to 1.35 on Blockpass.
* **Regulated finance:** CEMAC Regulation 02/24 lets institutions rely on a regulated third party for
  customer due diligence, with identity data and documents provided on request (arts. 69 to 72). Kola ID
  fits as the rails for that reliance; the issuer keeps the file. A compliance mode (an encrypted pointer
  only the issuer can open, on lawful request) is on the roadmap.
* **Go-to-market:** one issuer and one app per vertical as design partners, a hosted check page so apps
  never touch Midnight directly, then mainnet and the other CEMAC countries.

## Limitations and roadmap

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). In short: a malicious issuer can attest false facts
(mitigated by issuer approval and removal; staking and slashing are on the roadmap); removing an issuer
does not retro-revoke its credentials yet (per-issuer trees planned); a revocation invalidates in-flight
proofs, so revocations should be batched; fee settlement in NIGHT is a roadmap item. Also planned: a
typed claim field so one registry can hold several credential types, the compliance mode above, and
deploying the Co-op and Skills registries to Preprod.

## License

Apache-2.0. See [LICENSE](LICENSE). Built by Mbanya Dev for the Midnight Buildathon (Wave 3).
