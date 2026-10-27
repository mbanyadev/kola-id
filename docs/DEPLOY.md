# Deploying Kola ID to Midnight Preview

Status (27 Oct 2026): the contract compiles with proving keys and passes all simulator tests. The public
demo runs in local simulator mode. Preview deployment is the next step and needs the items below.

## What a Preview deployment needs

1. **A proof server** (version 8.1.3 per the support matrix) on `localhost:6300`, normally the Docker image
   `midnightntwrk/proof-server:8.1.3`.
2. **A funded Preview wallet.** Get tNIGHT from the Preview faucet
   (https://midnight-tmnight-preview.nethermind.dev/, captcha, rate limited), then register it for DUST
   generation so it accrues tDUST to pay fees. A throwaway test wallet is enough; it holds no real value.
3. **Endpoints** (Midnight-hosted, no token): node `https://rpc.preview.midnight.network`, indexer
   `https://indexer.preview.midnight.network/api/v4/graphql` (WebSocket `.../graphql/ws`).
4. **Midnight.js 4.1.1** providers (indexer public data provider, level private state provider, HTTP ZK
   config provider pointing at `contracts/managed/kola-id`, HTTP proof provider) and the compiled contract.
5. For the browser path: the **Lace** extension on Preview via DApp Connector API 4.0.1.

Explorers: https://preview.midnightexplorer.com/ · https://midnight-preview.subscan.io/
