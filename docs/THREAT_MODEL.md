# Kola ID threat model

| Threat | Mitigation in the contract | Test |
|---|---|---|
| Someone uses another person's credential | Proof must show knowledge of `holderSecret` with `holderKey(secret) == credential.holderPk` | "a stolen credential is useless without the holder secret" |
| Forged credential | Leaf must be in the tree under a valid root; only approved issuers can insert | "self-made credential", "unapproved issuer" |
| Path for someone else's leaf | `path.leaf == persistentCommit(credential, salt)` | "a path for a different leaf is rejected" |
| Revoked credential replayed with an old path | Slot zeroed and `resetHistory()` drops old roots | "the issuer revokes Manka…" |
| One person, many accounts (sybil) | Per-app, per-epoch nullifier must be new | "a second sign-up is rejected" |
| Re-issued credential used for a second account | Nullifier depends on the holder secret, not the credential | revocation test, re-issue part |
| Apps colluding to track a user | Nullifiers are domain-separated per app; nothing else about the user is disclosed | "different, unlinkable nullifiers" |
| Back-dated `today` to dodge expiry or stale screening | `today` bound to block time with one day of slack | "`today` must match block time" |
| Future-dated sanctions screening | `screenedDay <= today` | sanctions test |
| Non-owner changes an app's policy | Owner key must match the stored owner | "only the owner can change a policy" |
| Non-admin edits the issuer registry | Admin key check | "rejects addIssuer / removeIssuer" |
| Issuer revokes someone else's credential | Must open a commitment whose `issuerPk` is its own; slot index computed in-circuit | "only the issuing issuer can revoke" |
| Revocation linked to an app account | Proofs never disclose the leaf or its index | transcript test |

Known limitations (roadmap):

* **Malicious issuer** can attest false facts. Mitigated by admin approval, public issuer keys and removal;
  staking and slashing planned.
* **Removing an issuer** stops new issuance but does not retro-revoke its credentials (per-issuer trees or
  tree generations planned).
* **`resetHistory()`** invalidates in-flight proofs of every holder; batch revocations (for example daily).
* **Nullifier front-running:** a nullifier only appears in the holder's own transaction; someone copying it
  cannot produce a valid proof for it, so the worst case is a failed duplicate.
* **Disclosed root** says only "this credential existed at root R". The SDK always proves against the newest
  root so the anonymity set is the whole tree.
* **Admin** is a single key in the MVP; a multisig or DAO is planned.
