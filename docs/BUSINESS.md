# Kola ID: business case

> Status, honestly: Kola ID is an early product. It is a working contract on Midnight Preprod, an SDK and a demo. It has **no customers, no signed issuers and no revenue yet**. Everything below about pricing and go-to-market is a proposal.

## 1. Who pays, and why

**Buyers (relying apps) in Cameroon, then CEMAC and wider Africa:**
1. **Mobile-money agents and super-agent networks, exchanges and lending apps**: they must identify every customer before a business relationship starts, and they re-do the same ID check that a bank or operator has already done.
2. **Beyond finance**: betting operators (age 21+), commodity buyers sourcing from co-ops, and job platforms hiring certified trades. See [use cases](use-cases/README.md).

**What they get:** a yes/no proof that a person passed an approved issuer's check, fresh enough for their policy, once per person (Sybil-resistant). They get it in seconds, without collecting or storing ID scans.

**Issuers:** KYC providers, banks, microfinance institutions and mobile-money operators (KYC registry); co-op unions (Co-op registry); institutes and exam boards (Skills registry). They earn when a credential they issued is reused.

**Holders** pay nothing.

## 2. Market

| Fact | Figure | Source |
|---|---|---|
| Registered mobile-money accounts, Sub-Saharan Africa, 2024 | 1.1 billion (+19% y/y); 283 million active (30-day); US$1.1 trillion transacted | [GSMA, State of the Industry Report on Mobile Money 2025](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-for-development/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf) |
| Mobile-money accounts in Cameroon, end-2024 | 30,992,177, i.e. 65% of CEMAC's 51,276,950 | [BEAC, Rapport sur les services de paiement dans la CEMAC 2024](https://www.beac.int/wp-content/uploads/2026/04/RAPPORT-SUR-LES-SERVICES-DE-PAIEMENT-DANS-LA-CEMAC-2024-.pdf), table 13 |
| Mobile-money transactions in Cameroon, 2024 | 2.73 billion transactions, ~26.8 trillion FCFA | BEAC 2024, table 13 |
| Mobile-money points of service, CEMAC | 634,589 at end-2024, up 41% from 449,176 | BEAC 2024 |

Every new account and every new agent relationship is an identification event. Kola ID does not need to replace those checks: it monetises the **second, third and tenth time** the same person has to be checked by a different app.

## 3. Regulation

- **AML/CFT:** CEMAC Regulation No. 02/24/CEMAC/UMAC/CM (Libreville, 20 December 2024) requires identification and verification before a business relationship (art. 20, art. 29). It **allows reporting entities to rely on a regulated third party** for due diligence (art. 69), with conditions (art. 70), and requires the third party to forward identification data without delay and copies of documents on first request (art. 72). Ultimate responsibility stays with the reporting entity. [source](https://gabac.org/wp-content/uploads/2025/05/Reglement-N%C2%B002-24-CEMAC-UMAC-LBC-FT-Eng.pdf)
  - **How Kola ID fits:** for regulated finance, Kola ID is the rails for third-party reliance. The issuer is the regulated third party that holds the file. The app gets a proof and a nullifier at sign-up, and obtains the file from the issuer when the law requires it. We do **not** claim the app can stay ignorant of identity where the law says otherwise. A "compliance mode" (an encrypted pointer in the proof that only the issuer can resolve, on lawful request) is on the roadmap.
- **Data protection:** Cameroon's Law No. 2024/017 of 23 December 2024 on personal data protection. [source](https://www.prc.cm/en/multimedia/documents/10271-law-n-2024-017-of-23-12-2024-web) Its compliance grace period ended in June 2026 and cross-border transfers need prior authorisation ([Law Lab Africa summary](https://research.lawlab.africa/cameroon/)). Collecting less personal data is the cheapest way for an app to comply, and Kola ID puts no personal data on-chain.
- **Gaming:** minors (under 21) are barred and online operators must check age. See [gaming-age.md](use-cases/gaming-age.md).
- **Co-ops:** EUDR applies from 30 Dec 2026 for large and medium operators. See [coop-membership.md](use-cases/coop-membership.md).

## 4. Pricing (proposed)

The **app pays per successful proof**; failed proofs are free. The contract already counts every successful proof per app on-chain (`verifications`, sign-ups plus returning logins), and every sign-up also publishes a new nullifier, so both sides can audit the bill from public state.

| Tier | Price | For |
|---|---|---|
| Pilot | first 1,000 proofs per app free | design partners |
| Standard | **150 FCFA (≈ €0.23) per sign-up proof**; 10 FCFA per returning login | betting, jobs, co-op buyers, unregulated apps |
| Compliance (roadmap) | 300 FCFA per proof, with issuer file access under a reliance agreement | regulated finance |

- **Revenue split:** 40% to the issuer whose credential was used, 60% to Kola ID (protocol, SDK, hosting of the proof server, support).
- **Why apps switch:** comparable fresh-check prices are **US$1.35 per verification** on Sumsub Basic with a US$149 monthly minimum ([Sumsub pricing](https://sumsub.com/pricing/)) and **US$1.35 to US$1.00 per KYC** on Blockpass with a US$99 monthly minimum on Basic ([Blockpass pricing](https://www.blockpass.org/pricing/)). €1 = 655.957 FCFA (fixed peg), so 150 FCFA is a fraction of a fresh check, with no monthly minimum. Smile ID does not publish prices.
- **Why issuers join:** they turn a cost centre (the KYC they already did) into recurring revenue, without sharing their customer list.
- Midnight transaction fees (DUST) are paid by the app's wallet. These must be measured on mainnet before prices are final.

## 5. Go-to-market (proposed)

1. **Wave 3 (now):** open-source contract, SDK and demo; three non-finance presets.
2. **Next 3 months: sign one issuer and one app per vertical, as unpaid design partners.**
   - KYC registry: one KYC provider or microfinance institution in Douala or Buea, with one exchange or lending app.
   - Co-op registry: one cocoa union in the South-West, with one buyer preparing for EUDR.
   - Skills registry: one technical institute, with one job platform or installer.
3. **Integration offer:** an SDK for issuers (issue and revoke) and a hosted check page for apps (one redirect, one webhook with the nullifier), so neither side needs to touch Midnight directly.
4. **Then:** a reliance-agreement template for regulated apps (with a local lawyer); mainnet deployment; extend to the other CEMAC countries, which share the same AML regulation.

Risks we know about: issuers may not want to share revenue with a new network; regulators must accept the reliance model; mainnet fees are not yet known; Midnight wallet adoption in Cameroon is low today (the hosted check page addresses this).

## 6. Competitors

| | What it is | How Kola ID differs |
|---|---|---|
| [Smile ID](https://usesmileid.com/) | African KYC leader (claims 500M+ checks) | A natural **issuer** for Kola ID, not only a rival: Kola makes its checks reusable without sharing the person |
| [Youverify](https://youverify.co/) | African KYC/AML platform, 1,400+ businesses, 145 jurisdictions | Same: a candidate issuer |
| [Sumsub](https://sumsub.com/pricing/) | Global KYC; offers "Sumsub ID" reusable KYC | Reuse stays inside one vendor and the app still receives personal data; Kola is issuer-neutral and gives apps only a proof |
| [Privado ID](https://www.privado.id/) | ZK credentials on EVM/Polygon ("prove once, use everywhere") | Closest in concept. Kola is built on Midnight's private state and Compact, with per-app nullifiers and on-chain issuer registries; focused on CEMAC issuers and policies |
| [World ID](https://world.org/world-id) | Proof of personhood via Orb biometrics | Proves "a unique human", not age, residency, membership or qualification; needs biometric hardware |
| [Hyperledger Identus](https://www.lfdecentralizedtrust.org/projects/identus) | Open-source SSI toolkit (DIDs, VCs) | A toolkit, not a market: no issuer registry, policies or billing out of the box |

## 7. What we are asking for
Midnight Build Club support, introductions to one issuer and one app in each vertical, and help testing fees and the proof server on mainnet.
