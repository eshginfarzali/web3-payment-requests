# Web3 payment requests

Educational dApp for a simple invoice / payment-request flow, written in TypeScript.
It uses a freely mintable `mUSD` test token on a local Hardhat chain or the Sepolia testnet.
It does not connect to a bank and does not use real money.

## What it does

1. A merchant creates a request for a specific payer, token and amount, optionally with a due date.
2. The payer approves the contract to spend that many test tokens (`approve`).
3. The payer pays (`payRequest`); the contract moves the tokens to the merchant and marks the
   request as paid. Payment is refused after the due date.
4. The merchant can cancel a request that has not been paid yet (`cancelRequest`).

The invoice note is stored on-chain only as a hash. Never put personal or confidential data
directly on a public blockchain.

## Project layout

| Path | What |
|---|---|
| `contracts/PaymentRequests.sol` | Request / pay / cancel logic |
| `contracts/MockUSD.sol` | ERC20 test token, anyone can mint |
| `test/PaymentRequests.ts` | Contract tests (Hardhat + Chai) |
| `scripts/deploy.ts` | Deploys both contracts, writes addresses to `web/src/deployments.json` |
| `scripts/verify.ts` | Publishes source code on Etherscan |
| `web/` | Browser UI (TypeScript + Vite + ethers.js) |
| `typechain-types/` | Generated TypeScript types for the contracts (by `npm run compile`) |

## Setup

```sh
npm install
npm test            # compiles, generates types, runs the 11 tests
npm run typecheck   # type-checks Hardhat code and the web app
```

## Run locally

In three terminals:

```sh
npm run node          # local blockchain on :8545
npm run deploy:node   # deploy + give accounts 0-4 1000 mUSD each
npm run web           # http://localhost:5173
```

In the page choose **"Yerli test hesabları"** to sign with Hardhat's unlocked test accounts
(no wallet needed). Restarting `npm run node` wipes the chain; run `deploy:node` again.

### With MetaMask on localhost

1. In MetaMask add the network: RPC `http://127.0.0.1:8545`, chain id `31337`, symbol `ETH`
   (or press "Hardhat Localhost şəbəkəsinə keç" in the page).
2. Import a test account with its private key, printed by `npm run node`.
   These keys are public; never send real funds to them.
3. Choose **MetaMask** in the page and connect.

After restarting the node, MetaMask may show nonce errors: Settings → Advanced →
"Clear activity tab data".

## Deploy to Sepolia

Writing to a blockchain requires signing with a private key, so this step is done with your
own test wallet.

1. **Create a test-only account in MetaMask.** Never use an account that holds real funds:
   its private key will sit in a file on your machine.
   - MetaMask → account menu → "Add account".
   - Account details → "Show private key" → copy it (starts with `0x`).
2. **Get free Sepolia ETH** for gas from a faucet, for example:
   - Google Cloud Web3 faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
   - Alchemy faucet: https://www.alchemy.com/faucets/ethereum-sepolia

   About 0.05 Sepolia ETH is plenty for deploying both contracts.
3. **Get a free RPC URL** (the node your deploy is sent through):
   - Alchemy: https://dashboard.alchemy.com → create app → network "Ethereum Sepolia" → copy the HTTPS URL.
   - or Infura: https://app.infura.io → API key → Sepolia endpoint.
4. **Create `.env`** from the template and fill it in. `.env` is git-ignored, so it is never
   pushed to GitHub:

   ```sh
   cp .env.example .env
   ```

   ```ini
   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>
   DEPLOYER_PRIVATE_KEY=0x<test-account-private-key>
   ETHERSCAN_API_KEY=<optional, from etherscan.io → API keys>
   ```

5. **Deploy:**

   ```sh
   npm run deploy:sepolia
   ```

   The script prints the contract addresses and a Sepolia Etherscan link.
6. **(Optional) Verify the source code on Etherscan**, so anyone can read the code running at
   the address (needs `ETHERSCAN_API_KEY`):

   ```sh
   npm run verify:sepolia
   ```

If `npm run deploy:sepolia` says `HH100: Network sepolia doesn't exist`, `.env` is missing or
`SEPOLIA_RPC_URL` / `DEPLOYER_PRIVATE_KEY` is empty.

The Sepolia address is saved to `web/src/deployments.json`; commit it so others can use the
same contract. In the page choose **MetaMask**, switch to Sepolia, and use
"+100 test mUSD al" to mint test tokens.

## Limits

This is a learning project, not production payment software. A real system would need token
allowlisting, legal and privacy review, monitoring and an independent security audit.
