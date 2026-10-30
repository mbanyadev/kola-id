# Qualification proof for job platforms

**Buyer:** job and gig platforms and employers hiring certified trades. **Issuer:** accredited training institutes and exam boards, approved in a separate **Kola Skills registry**. **Preset:** Buea Technical Institute → Mboa Jobs (both fictional), certified solar technicians.

## The problem
- Diploma fraud is serious enough that Cameroon's Ministry of Public Service launched a diploma-authentication platform on 1 October 2024 to verify certificates submitted to the state. [source](https://www.minfopra.gov.cm/index.php/fr/a-la-une/2278-modernization-of-the-public-service-diploma-authentication-platform-on-track)
- Private employers and platforms have no such tool: they phone schools, or trust a scan.

## Policy (public, on-chain)
| Field | Value | Meaning in this registry |
|---|---|---|
| `minAgeDays` | `minAgeDays(18)` | adult worker |
| `countries` | any | |
| `requireSanctionsClear` | true | the institute authenticated the certificate |
| `maxScreenAgeDays` | 730 | authenticated in the last 2 years |
| `expiryDay` (in the credential) | licence expiry | expired licences fail |
| nullifier | per platform | one profile per person |

## What happens
1. The institute issues Manka a credential when it authenticates her certificate.
2. She proves to Mboa Jobs: certified, adult, licence current. Mboa Jobs gets no transcript, no ID number, no school name.
3. "Quick Diploma Centre", not accredited, tries to issue a certificate: rejected with "not an approved issuer". The forgery never enters the registry.
4. An expired licence is refused (tested).

## Honest limits
- One registry proves "certified by an accredited institute". Proving a *specific* qualification (solar vs plumbing) needs one registry per qualification today, or the v2 typed claim field.
- The registry admin (for example an exam board or trade association) is trusted to approve only real institutes.
