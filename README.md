# Kola ID

**Verify once. Prove anywhere. Stay unlinkable.**

Kola ID is a reusable, private identity layer on [Midnight](https://midnight.network). An approved
issuer (a KYC provider, bank or mobile-money operator) checks a person once and writes a *hiding
commitment* to their credential on-chain. From then on, the person proves to any app, in zero
knowledge, only what that app asks: **over 18**, **resident in an allowed country**, **sanctions
screening clear and recent**. The app gets one yes/no and a per-app nullifier. It never sees a name,
birth date, country, document or even which issuer verified the person, and two apps cannot link the
same person.

**Live demo:** https://mbanyadev.github.io/kola-id/ (runs the compiled contract in your browser, see [Demo](#demo))

| | |
|---|---|
| Contract | [`contracts/src/kola-id.compact`](contracts/src/kola-id.compact): 7 proving circuits + 6 pure helpers |
| Toolchain | Compact compiler **0.31.1** (language 0.23), compact-runtime 0.16.0, ledger 8: the versions the [support matrix](https://docs.midnight.network/relnotes/support-matrix) lists for Preview, Preprod and Mainnet |
| Tests | 30 simulator tests, all passing (`npm test`) |
| Network target | Midnight **Preview** |
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
sdk/src/                        witnesses, builders, simulator (TypeScript)
tests/                          Vitest simulator tests
apps/demo/                      web demo (Vite, no framework), deployed to GitHub Pages
docs/                           design, 0.31.1 compatibility notes, threat model
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
npm test                            # 30 simulator tests
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
* Mutation check: flipping the slot-index direction or deleting the root check in the contract makes
  the revocation tests fail, so they test the contract, not the fixture.
* Open the [demo](https://mbanyadev.github.io/kola-id/) and press the guided steps 1 to 8.

## Demo

The web demo has four views (registry admin, issuer "Kumba Verify", holder wallet, apps "Sawa Exchange"
and "Ndole Games") and a live view of the public ledger. In **local simulator mode** it runs the real
compiled Kola ID circuits in the browser, against a local ledger, so anyone can try it without a wallet.
The guided steps follow the story: approve the issuer, issue to Manka (adult) and Ebai (17), publish
policies, Manka signs up (✅), tries again (❌ already registered), signs up to a second app (✅, a
different nullifier), Ebai is rejected (❌ too young), the issuer revokes Manka (❌), re-issues, and she
logs back in (✅). All names are fictional.

Preview deployment status and the steps to reproduce it are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Business model

Apps pay per successful verification (counted on-chain per app; invoicing off-chain in the MVP), below
the price of a fresh KYC check. Issuers earn a share every time a credential they issued is reused, which
is how we recruit them. A compliance tier sells policy templates and audit exports. The wedge is
cross-border fintech and crypto on-ramps serving African and other emerging markets, where users are
re-verified constantly and storing ID documents is a data-protection liability; then age-gated commerce
and sybil-resistant airdrops and DAO votes. See [docs/DESIGN.md](docs/DESIGN.md).

## Limitations and roadmap

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). In short: a malicious issuer can attest false facts
(mitigated by issuer approval and removal; staking and slashing are on the roadmap); removing an issuer
does not retro-revoke its credentials yet (per-issuer trees planned); a revocation invalidates in-flight
proofs, so revocations should be batched; fee settlement in NIGHT is a roadmap item.

## License

Apache-2.0. See [LICENSE](LICENSE). Built by Mbanya Dev for the Midnight Buildathon (Wave 3).
