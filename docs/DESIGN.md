# Kola ID: design

*Verify once. Prove anywhere. Stay unlinkable.*

Status: design document, written before the Midnight Buildathon Wave 3 build window (27 Oct – 16 Nov 2026).
The contract now exists and compiles on 0.31.1 (`contracts/src/kola-id.compact`). Where the implementation
differs from the sketches below, the code wins; the differences are listed in [compat-0.31.1.md](compat-0.31.1.md).

Target toolchain (from the docs.midnight.network support matrix for Preview / Preprod / Mainnet, ledger 8):
Compact devtools 0.5.1 · compiler **0.31.1** · compact-runtime 0.16.0 · Compact JS 2.5.1 ·
Midnight.js 4.1.1 · DApp Connector API 4.0.1 · proof server 8.1.3 · node 1.0.400 · Preview indexer 4.3.5.
Network: **Preview**. Compiler 0.34/0.35 target ledger 9 and are not used.

---

## 1. Problem

Every regulated or age-gated app asks the same person to prove the same facts again and again: upload
an ID, take a selfie, wait. That costs users time, costs apps per-check fees and drop-off, and leaves a
copy of the person's documents in every app's database, ready to leak.

Today's "reusable KYC" fixes the repetition by creating a new problem. A central provider sees every app
a person signs up to, and the apps can join their records on a shared identifier.

The facts apps actually need are usually yes/no: *is this person over 18? Allowed in our countries?
Screened against sanctions lists recently? Not already signed up?* None of those needs a name, a birth
date or a document number.

## 2. Users

| Role | Who | What they want |
|---|---|---|
| **Holder** | An individual, often in a market where cross-border apps over-verify or refuse service | Verify once, reuse it, reveal nothing extra, not be tracked across apps |
| **Issuer** | KYC vendors, banks, mobile-money operators, telcos, universities | Monetise checks they already run; never see where credentials are used |
| **Relying app** | Exchanges and fintechs, age-gated commerce and gaming, DAOs, airdrops, marketplaces | A cheap, instant yes/no they can audit, sybil resistance, and no PII to store |
| **Registry admin** | Kola ID (later a multisig/DAO) | Approve issuers and keep the registry honest |

## 3. Business model (venture scale)

* **Per-verification fee**, paid by the relying app for each successful proof. It is priced below a fresh
  KYC check because no human or document review is needed.
* **Issuer revenue share**: part of every verification against an issuer's credentials goes to that
  issuer. Checks they already ran keep earning. This is how we recruit issuers.
* **Policy and compliance tier** (subscription): hosted policy templates (country lists by licence,
  sanctions-freshness windows), audit exports of verification counts, SLAs.
* **Why it scales**: one integration serves every app; marginal cost per verification is one proof and
  one transaction; every new issuer adds holders, which attracts apps, which attracts issuers.
* **Wedge market**: cross-border fintech and crypto on-ramps serving Africa and other emerging markets,
  where users are verified repeatedly, documents vary, and data-protection laws (e.g. Nigeria's NDPA,
  Kenya's DPA, the EU's GDPR for EU-facing apps) make storing PII a liability. Then age-gated commerce
  and sybil-resistant airdrops/DAO voting, which need the same primitives.

MVP accounting: the contract keeps a public per-app verification counter, and invoicing is off-chain.
On-chain settlement of fees in NIGHT is a roadmap item.

## 4. Architecture

```
 Issuer console (web) ──issueCredential──┐
                                         ▼
 Holder wallet (Lace, DApp Connector) ─proveForApp─►  Kola ID contract (Compact, Midnight Preview)
   private state: attributes, salt,        ▲            public ledger: issuers, credential tree (roots),
   holderSecret, Merkle path               │            app policies, per-app nullifiers, counters
                                           │
 Relying app ── reads nullifier / counter / tx result via indexer (Midnight.js)
 Proof server 8.1.3 (local Docker) generates the ZK proofs; nothing private leaves the holder's machine.
```

Components:
* `contracts/src/kola-id.compact`: the one contract.
* `sdk/`: a TypeScript wrapper over Midnight.js 4.1.1 (`issue`, `prove`, `revoke`, `registerApp`).
  It manages the holder's private state (witnesses) and Merkle paths from the indexer.
* `apps/demo/`: a React + Vite site with three tabs: **Issuer**, **Holder**, and **App** ("Sawa Exchange").
* `tests/`: Vitest against the compiled contract with compact-runtime (simulator), plus a Preview e2e script.

### 4.1 Data model

Credential attributes (private; signed by inclusion, not by signature):

| Field | Type | Meaning |
|---|---|---|
| `holderPk` | Bytes<32> | `persistentHash([pad(32,"kola:holder"), holderSecret])` |
| `issuerPk` | Bytes<32> | Issuer's derived public key |
| `dobDay` | Uint<32> | Birth date as a day number (days since 1970-01-01) |
| `country` | Uint<16> | ISO 3166-1 numeric code |
| `sanctionsClear` | Boolean | Issuer screened the holder and found no match |
| `screenedDay` | Uint<32> | Day of that screening |
| `expiryDay` | Uint<32> | Credential expiry |
| `salt` | Bytes<32> | Random; makes the leaf hiding |

Leaf: `leaf = persistentCommit(attributes, salt)`. The commitment is the only thing written on-chain.

Public ledger (sketch):

```compact
export ledger admin: Bytes<32>;
export ledger issuers: Set<Bytes<32>>;                       // approved issuer public keys
export ledger credentials: HistoricMerkleTree<20, Bytes<32>>;// ~1M leaves; recent roots accepted
export ledger policies: Map<Bytes<32>, Policy>;              // appId -> policy
export ledger nullifiers: Map<Bytes<32>, Set<Bytes<32>>>;    // appId -> used nullifiers (per epoch)
export ledger verifications: Map<Bytes<32>, Counter>;        // appId -> successful proofs (billing)

struct Policy {
  owner: Bytes<32>;
  minAgeYears: Uint<8>;            // 0 = no age check
  countries: Vector<8, Uint<16>>;  // allow-list, 0 = empty slot; all-zero = any country
  requireSanctionsClear: Boolean;
  maxScreenAgeDays: Uint<16>;      // sanctions screening freshness
  epoch: Uint<32>;                 // bump to reset sybil window
}
```

### 4.2 Circuits

| Circuit | Caller | Proves privately | Discloses / writes publicly |
|---|---|---|---|
| `addIssuer(pk)` / `removeIssuer(pk)` | admin | knows `adminSecret` with `derive(adminSecret) == admin` | issuer pk added/removed |
| `issueCredential(leaf)` | issuer | knows `issuerSecret` with `derive(issuerSecret) ∈ issuers` | `leaf` inserted (a hiding commitment); leaf index |
| `revokeCredential(index)` | issuer | is the issuer of that leaf (opens the commitment's `issuerPk` privately) | `insertIndexDefault(index)` then `resetHistory()` |
| `registerApp(appId, policy)` | app | knows `appSecret`; `policy.owner == derive(appSecret)` | appId, policy |
| `proveForApp(appId, today)` | holder | owns a valid, unrevoked credential satisfying the policy | `today`, `nullifier`; counter +1 |

`proveForApp`, the core (pseudocode):

```compact
witness holderSecret(): Bytes<32>;
witness credential(): Credential;          // attributes + salt, from private state
witness credentialPath(): MerkleTreePath<20, Bytes<32>>;

export circuit proveForApp(appId: Bytes<32>, today: Uint<32>): [] {
  const p = policies.lookup(disclose(appId));
  const c = credential();
  const path = credentialPath();

  // 1. Today is honest: bound the public day to block time (no raw block-time accessor exists).
  assert(blockTimeGte(disclose(today) * 86400), "today is in the future");
  assert(blockTimeLt((disclose(today) + 2) * 86400), "today is stale");

  // 2. Possession and binding: the credential is mine and it is in the tree.
  assert(c.holderPk == persistentHash<Vector<2, Bytes<32>>>([pad(32, "kola:holder"), holderSecret()]), "not holder");
  assert(path.leaf == persistentCommit<CredAttrs>(c.attrs, c.salt), "path/credential mismatch");
  // disclose() is required: the root is derived from witness data (docs: "Making use of Merkle trees").
  assert(credentials.checkRoot(disclose(merkleTreePathRoot<20, Bytes<32>>(path))), "unknown or revoked root");

  // 3. Policy predicates, all on private values (Uint comparisons, never Field).
  assert(today < c.expiryDay, "expired");
  if (p.minAgeYears > 0) {
    // conservative: N*365 + floor(N/4) + 1 days (never passes early; at most 1 day late)
    assert(c.dobDay + minAgeDays(p.minAgeYears) <= today, "too young");
  }
  assert(countryAllowed(c.country, p.countries), "country not allowed");
  if (p.requireSanctionsClear) {
    assert(c.sanctionsClear, "not screened clear");
    assert(today - c.screenedDay <= p.maxScreenAgeDays, "screening too old");
  }

  // 4. Per-app, per-epoch nullifier: one sign-up per person per app, unlinkable across apps.
  const nf = persistentHash<Vector<4, Bytes<32>>>(
      [pad(32, "kola:nf"), appId, epochBytes(p.epoch), holderSecret()]);
  assert(!nullifiers.lookup(appId).member(disclose(nf)), "already registered");
  nullifiers.lookup(appId).insert(disclose(nf));
  verifications.lookup(appId).increment(1);
}
```

Design choices:
* **Issuer approval at insertion.** `issueCredential` only accepts leaves from approved issuers, so
  membership in `credentials` already implies an approved issuer. The issuer's identity never has to be
  revealed at proof time; disclosing it would split holders into smaller, linkable groups.
* **Revocation without linkage.** The issuer zeroes the leaf (`insertIndexDefault`) and calls
  `resetHistory()` so old roots stop verifying. The credential index or commitment is **never** disclosed
  in `proveForApp`, so revocation can't be joined to any app's records. Cost: holders must refresh their
  Merkle path after a revocation. Revocations are batched daily in production.
* **Issuer removal.** The MVP does not retro-revoke a removed issuer's credentials. v2 uses per-issuer
  trees or tree generations, listed as a known limitation.
* **Sybil resistance with bounded state.** Nullifier sets are per app and per policy epoch. The app owner
  bumps the epoch to start a fresh window, and old sets can be pruned. This follows the docs' guidance to
  bound nullifier-set growth.
* **Root choice.** The disclosed root says only "this credential existed by root R". The SDK always proves
  against the newest root, so the anonymity set is every credential in the tree, not one issuance window.
* **Country check** is a fixed-size `Vector<8, Uint<16>>` fold, so circuit size is constant.
* **Login vs sign-up.** The MVP implements sign-up (nullifier must be new). A `proveAgain` variant (nullifier
  must exist) for re-login is a stretch goal.

## 5. What is private and what is public

| Data | Where it lives | Visibility |
|---|---|---|
| Name, document, selfie | Issuer's own KYC system | Never touches Midnight |
| `dobDay`, `country`, `sanctionsClear`, `screenedDay`, `expiryDay`, `salt` | Holder's private state | **Private**: used only inside proofs |
| `holderSecret` | Holder's private state | **Private** |
| Credential commitment (leaf) + index | Ledger | Public, but hiding; never shown at proof time |
| Which issuer issued a given credential | Inside the commitment | **Private** |
| Approved issuer public keys | Ledger | Public (issuers are accountable entities) |
| App policy (min age, country list, freshness) | Ledger | Public: users see exactly what is checked |
| `today` (day number) | Transaction | Public, bounded by block time |
| Per-app nullifier | Ledger | Public; unique per (holder, app, epoch); unlinkable across apps |
| Verification count per app | Ledger | Public (billing and audit) |
| Revocation events | Ledger | Public index only; can't be tied to any proof |

What the app learns from a successful proof: "a person not previously registered in this epoch meets
this policy". Nothing more.

## 6. Demo flow (target 3–4 minute video)

1. **Admin** approves issuer "Kumba Verify" (fictional) on Preview.
2. **Issuer tab**: issue credentials to two holders: Manka (adult, Cameroon, screened 10 days ago) and Ebai
   (17, Cameroon). The explorer shows only commitments.
3. **App tab**: "Sawa Exchange" registers a policy: 18+, country ∈ {Cameroon, Ghana, Kenya, Nigeria},
   sanctions clear within 90 days.
4. **Holder tab (Manka)**: "Verify with Kola ID" → Lace signs → proof generated locally → ✅. The app
   receives only the nullifier. Show the transaction: no attributes visible.
5. Manka tries to register again → ❌ "already registered" (sybil resistance).
6. Manka proves to a second app, "Ndole Games" (18+ only) → ✅ with a **different** nullifier.
   Side by side: the two apps can't link her.
7. Ebai tries Sawa Exchange → ❌ "too young". Nothing about his age is revealed beyond the failure.
8. Issuer revokes Manka's credential → her next proof fails → she gets a new credential → passes.
9. Close with the per-app verification counter (billing) and the architecture slide.

## 7. Quality plan

* Simulator unit tests for every circuit: happy paths; each predicate failing; wrong holder secret; path
  for a different leaf; revoked leaf after `resetHistory`; duplicate nullifier; cross-app nullifiers
  differ; epoch bump; non-issuer `issueCredential`; non-owner policy change; age boundary days
  (birthday −1, 0, +1, leap years).
* Preview e2e script: deploy → issue → prove → revoke, run in CI where the proof server is available,
  otherwise documented as a manual run with recorded output.
* Threat-model section in the README: replayed proofs, a malicious issuer, a stale `today`, root
  freshness, front-running the nullifier.

## 8. Day-by-day build plan (27 Oct – 16 Nov 2026)

Submission target: **Sun 15 Nov**, a day of buffer before the 16 Nov close. The exact closing time must be
confirmed on the AKINDO page.

| Date | Goal | Done when |
|---|---|---|
| Tue 27 Oct | Toolchain on Preview; compile scaffold with 0.31.1; **verify every stdlib call used here** (HistoricMerkleTree `checkRoot`/`insertIndexDefault`/`resetHistory`, `merkleTreePathRoot`, `persistentCommit`, `blockTimeGte/Lt`, Map-of-Set ledger nesting); repo public with `midnightntwrk` topic, Apache-2.0 | `compact compile` passes; findings logged in docs/compat-0.31.1.md |
| Wed 28 Oct | Ledger types, `addIssuer`/`removeIssuer`, admin key derivation | Simulator tests green |
| Thu 29 Oct | `issueCredential` + leaf commitment; TS helper to build leaves | Tests: approved vs unapproved issuer |
| Fri 30 Oct | `registerApp` + Policy; country fold | Tests for policy ownership |
| Sat 31 Oct | `proveForApp` part 1: binding, Merkle path, root check, expiry | Happy-path proof in simulator |
| Sun 1 Nov | `proveForApp` part 2: age, country, sanctions freshness, nullifier, counter | All predicate tests green |
| Mon 2 Nov | `revokeCredential` + resetHistory; epoch bump | Revocation tests green |
| Tue 3 Nov | Deploy to Preview; e2e script deploy→issue→prove | First proof tx on Preview |
| Wed 4 Nov | SDK: private-state store, witnesses, Merkle path from the indexer | `sdk.prove()` works from Node |
| Thu 5 Nov | Demo app skeleton (Vite + React), Lace via DApp Connector 4.0.1 | Wallet connects on Preview |
| Fri 6 Nov | Issuer tab | Issue from the UI |
| Sat 7 Nov | Holder tab: proof progress UI, clear errors | Prove from the UI |
| Sun 8 Nov | App tab: policy editor, nullifier and counter view, second app | Full demo flow in the UI |
| Mon 9 Nov | Revocation and re-issue in the UI; edge-case tests (age boundaries) | Steps 1–8 of the demo pass |
| Tue 10 Nov | QA day: fix bugs, tighten circuits, gas/proof-time notes | Test report in README |
| Wed 11 Nov | README (setup, architecture, Midnight integration, how to test), threat model | A fresh clone works by following the README |
| Thu 12 Nov | **Slide deck** (problem, solution, privacy table, architecture, business model, traction plan) | Deck exported to PDF |
| Fri 13 Nov | **Demo video** recording + edit | Video uploaded (check the length limit on AKINDO) |
| Sat 14 Nov | Progress description; polish UX copy; re-run e2e on Preview | Submission text final |
| Sun 15 Nov | **Submit personally** on AKINDO; check every link while signed out | Submitted |
| Mon 16 Nov | Buffer only: fixes and interview prep | — |

## 9. Fit with the Wave 3 judging criteria

| Criterion (weight) | How Kola ID scores |
|---|---|
| Engineering (40%) | A non-trivial Compact contract: Merkle membership with a binding check, private predicates, unlinkable nullifiers, revocation with root reset, bounded state; it compiles on 0.31.1 (the technical gate) |
| Quality assurance (15%) | Simulator tests per circuit and predicate, boundary tests, Preview e2e, threat model |
| Product (15%) | Solves a paid, repeated problem (re-KYC); clear users and wedge market |
| UX (15%) | One "Verify with Kola ID" button; readable failure reasons; the policy shown to the user before proving |
| Communication (10%) | Demo video + slide deck + README with an architecture diagram |
| Business (5%) | Per-verification fees + issuer revenue share + compliance tier |

Submission requirements to meet: public repo · `midnightntwrk` GitHub topic · Apache-2.0 · README
(setup, architecture, Midnight integration, how to test) · slide deck · demo video · progress description ·
available for a live interview · submitted personally (automated entry tools are prohibited).

**Uniqueness.** Wave 1 feedback said many entries shared the same domain, and other identity projects
exist. Kola ID stands apart on three things that are hard to fake in a demo:
(1) revocation that can't be linked to proofs, (2) sanctions screening with an enforced freshness window,
not just a static flag, and (3) per-app, per-epoch nullifiers with public, auditable app policies. The
emerging-market cross-border wedge is also a different go-to-market from the usual "generic DID wallet".

## 10. Risks and open questions

* The ledger ADT doc page read during research targets language 0.27 / compiler 0.35. Every method name
  above must be re-checked against **0.31.1** on 27 Oct, with fallbacks: a plain `MerkleTree` plus an
  on-chain root list if `HistoricMerkleTree` differs; a Map-of-Map if Map-of-Set nesting isn't supported.
* Proof generation time in the browser and proof server: measure on day 9 and keep circuit depth at 20
  unless it is too slow (depth 16 fallback).
* `resetHistory()` invalidates every in-flight proof, so revocations are batched.
* A malicious issuer can attest false facts. Mitigations: issuer approval, public issuer list, removal
  path, and (roadmap) issuer staking and slashing.
