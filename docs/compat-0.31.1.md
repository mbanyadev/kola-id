# Compact 0.31.1 compatibility notes (27 Oct 2026)

Checked by compiling `contracts/src/kola-id.compact` with `compact compile` 0.31.1 (language 0.23.0,
runtime 0.16.0) and running the simulator tests. Every stdlib and ledger call the design relies on works.

| Call | Result on 0.31.1 |
|---|---|
| `HistoricMerkleTree<20, Bytes<32>>` ledger field | ✅ |
| `.insert`, `.checkRoot`, `.insertIndexDefault`, `.resetHistory` (in circuits) | ✅ |
| `.findPathForLeaf`, `.pathForLeaf`, `.root`, `.history` (TypeScript side) | ✅ |
| `merkleTreePathRoot<20, Bytes<32>>(path)` | ✅ (root must be `disclose`d before `checkRoot`) |
| `persistentCommit<Credential>(c, salt)` over a struct | ✅ |
| `persistentHash<NullifierInput>(struct)` and `persistentHash<Vector<2, Bytes<32>>>` | ✅ |
| `blockTimeGte` / `blockTimeLt` (stdlib) | ✅ (simulator honours the `time` argument of `createCircuitContext`) |
| `Map<Bytes<32>, Counter>` with `insertDefault` + `lookup(k).increment(1)` | ✅ |
| `fold` with a named circuit and a struct accumulator; `fold` with an anonymous circuit | ✅ |
| `MerkleTreePathEntry.goes_left` | ✅ (path entries run leaf → root; `goes_left == false` = right child) |
| `reverse` on vectors | ❌ not in the 0.31.1 stdlib; replaced by a weighted fold |

Changes from the design sketch:

* **One global nullifier set** instead of a `Map` of `Set`s. The nullifier already hashes the app id and
  epoch, so a single `Set<Bytes<32>>` gives the same guarantees with simpler state.
* **`minAgeDays` in the policy** instead of `minAgeYears`. Compact has no division, so the SDK computes
  the conservative threshold (`years*365 + floor(years/4) + 1`) and the policy publishes it. The tests
  check it never lets anyone through before their real birthday.
* **Sanctions freshness** is written as `screenedDay <= today && screenedDay + maxDays >= today` to avoid
  unsigned underflow and to reject future-dated screenings.
* **Issuance discloses the issuer key** (needed for the `issuers.member` check). That is acceptable:
  issuers are accountable entities and the commitment never appears at proof time, so holders stay
  in the anonymity set of all credentials.
* **Revocation computes the slot index in-circuit** from the opened path, so an issuer can only zero
  the slot of a credential it actually issued.

Full compile (with proving keys) of 7 circuits takes about 30 s on an 8-core box; `--skip-zk` about 1 s.
