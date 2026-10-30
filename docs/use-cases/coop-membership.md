# Co-op membership proof for supply-chain buyers

**Buyer:** cocoa and coffee buyers and exporters sourcing from farmer cooperatives. **Issuer:** cooperative unions that keep the member roll, approved in a separate **Kola Co-op registry**. **Preset:** Fako Cocoa Farmers Union → Limbe Cocoa Buyers (both fictional).

## The problem
- The EU Deforestation Regulation (Reg. (EU) 2023/1115), as amended by Reg. (EU) 2025/2650, applies to large and medium operators from **30 December 2026** and to micro and small operators from **30 June 2027**. Operators must keep supplier information for five years. [source](https://trade.ec.europa.eu/access-to-markets/en/news/delay-until-december-2026-and-other-developments-implementation-eudr-regulation)
- In Cameroon, FAO and the government have validated a support plan for cocoa cooperatives because they face low organisational capacity and difficulty meeting EUDR requirements. [source](https://www.fao.org/cameroun/news/detail/cameroon-validates-support-plan-for-cooperatives-to-facilitate-cocoa-sales-in-the-european-union/en)

Buyers want to know they are paying a real, current co-op member, once. Co-ops hold that knowledge but handing every buyer the member roll exposes farmers' identities and lets buyers poach and profile them.

## Policy (public, on-chain)
| Field | Value | Meaning in this registry |
|---|---|---|
| `minAgeDays` | `minAgeDays(18)` | adult supplier (helps child-labour due diligence) |
| `countries` | Cameroon | farm in Cameroon |
| `requireSanctionsClear` | true | the union confirmed good standing |
| `maxScreenAgeDays` | 365 | good standing re-confirmed this season |
| nullifier | per buyer | one supplier account per member |

## What happens
1. The union issues Manka a credential after its annual roll audit. Only a commitment goes on-chain.
2. Manka proves to Limbe Cocoa Buyers: real, adult, current member of an approved co-op. The buyer does not learn her name, member number or even which union.
3. Tabe, whose good standing was last confirmed 400 days ago, is refused until the union renews it.
4. A co-op's key cannot issue into the KYC registry (tested), so this registry can't be used to fake ID checks.

## Honest limits
- Kola ID does **not** provide EUDR plot geolocation or deforestation-free evidence. It covers the "who is my supplier, and are they a genuine member" part, privately. Geolocation data stays with the co-op or its traceability system.
- If an auditor needs a named supplier, the buyer asks the co-op, which holds the record.
