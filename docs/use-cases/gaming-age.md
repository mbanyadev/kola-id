# Age check for betting and gaming (21+)

**Buyer:** online betting and gaming operators in Cameroon. **Issuer:** any KYC provider already approved in the Kola KYC registry. **Preset:** Mboa Bet (fictional) in the demo's *Beyond finance* tab.

## The problem
- Cameroon closes casinos, betting and public lotteries to anyone below **civil majority**: Decree No. 2019/2300/PM of 18 July 2019 (implementing Law No. 2015/012 of 16 July 2015), art. 16. [source](https://www.spm.gov.cm/site/sites/default/files/decret_jeux_hasard.pdf)
- Civil majority in Cameroon is **21** (Civil Code, art. 488). [source](https://lex.cameroun.cc/fr/cm/civil-code.pdf)
- Online operators must prevent minors' access, using an on-honour age statement plus identification data. Failure carries 1 to 3 years' imprisonment and/or a fine of 5 to 10 million FCFA (Penal Code, art. 249-7). [source](https://lex.cameroun.cc/fr/cm/penal-code/art-249-7)

So today an operator either trusts a self-declaration or collects and stores ID scans for every punter: a data-protection liability under Law No. 2024/017 on personal data. [source](https://www.prc.cm/en/multimedia/documents/10271-law-n-2024-017-of-23-12-2024-web)

## Policy (public, on-chain)
| Field | Value |
|---|---|
| `minAgeDays` | `minAgeDays(21)` = 7,671 days |
| `countries` | Cameroon (120) |
| `requireSanctionsClear` | false (an age gate, not AML) |
| nullifier | one account per person per app and epoch |

## What happens
1. Manka (28) already holds a Kola credential from Kumba Verify. Nothing new is collected.
2. She proves to Mboa Bet. Mboa Bet gets **yes** plus a nullifier. No birth date, no name, no document.
3. Ebai (19) is refused with "too young". He would pass an 18+ check elsewhere; the threshold is a public policy parameter, not code.
4. A second account from Manka is refused ("already registered with this app"), which also helps responsible-gambling self-exclusion.

## Honest limits
- The age is only as good as the issuer's original KYC check.
- If a regulator needs the operator to identify a punter (for example, a large win), the operator gets the file from the issuer under a reliance agreement. Kola ID does not remove that duty. See [BUSINESS.md](../BUSINESS.md#regulation).
