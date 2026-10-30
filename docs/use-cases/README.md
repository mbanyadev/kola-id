# Kola ID beyond finance

The same Kola ID contract, unchanged, serves industries outside finance. Each trust domain runs its own Kola ID deployment (a **registry**) whose admin approves only the right kind of issuer:

| Registry | Approved issuers | What the issuer's "check" means | Example app |
|---|---|---|---|
| KYC registry | licensed KYC providers, banks, mobile-money operators | ID verified, sanctions screened on day X | [Mboa Bet: age 21+](gaming-age.md) |
| Co-op registry | cooperative unions that keep a member roll | member in good standing on day X | [Limbe Cocoa Buyers: co-op membership](coop-membership.md) |
| Skills registry | accredited institutes and exam boards | certificate authenticated on day X | [Mboa Jobs: qualification](job-qualifications.md) |

Why separate registries rather than one: a co-op union must never be able to mint an ID check, and a training institute must never be able to mint a co-op membership. With one registry per domain, that is enforced by the contract's existing `approvedIssuers` set, with no new code. The tests check it (`tests/use-cases.test.ts`).

The contract's `sanctionsClear` / `screenedDay` pair is used generically as "the issuer's check passed, on this day", and `maxScreenAgeDays` as "how fresh that check must be". A typed claim field, so one registry can hold several credential types, is on the v2 roadmap.

**Try it:** open the demo's [Beyond finance tab](https://mbanyadev.github.io/kola-id/#beyond-finance) and press **Run: Manka passes three apps**. These presets run in the in-browser simulator (the real compiled circuits against a local ledger). The Preprod deployment is the KYC registry used by the main demo story; the Co-op and Skills registries have not been deployed to Preprod yet.

All people, issuers and apps in the presets are fictional.
