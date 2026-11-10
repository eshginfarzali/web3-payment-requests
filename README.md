# Web3 payment lab

[![test](https://github.com/eshginfarzali/web3-payment-requests/actions/workflows/test.yml/badge.svg)](https://github.com/eshginfarzali/web3-payment-requests/actions/workflows/test.yml)

Hands-on lessons that show how a blockchain works, using two payment scenarios. Everything
runs on a local test blockchain with test tokens: no bank, no real money. The lesson UI is in
Azerbaijani; code and docs are in English.

| Lesson | What you learn |
|---|---|
| **2 · Meal-voucher token (MEAL)** — start here | A company loads monthly meal allowances for its employees, employees pay at partner restaurants by QR, restaurants redeem tokens for a bank payout. 12 guided steps: for each step the page explains what happens in real life and on-chain, and shows a live ledger and the block chain. A rules console lets you try to break the rules yourself. |
| **1 · Payment requests** | A merchant creates an invoice, the payer pays with an ERC20 test token (`approve` + `transferFrom`), with cancellation, due dates and MetaMask. |

## Quick start

Requires Node.js 20+.

```sh
git clone https://github.com/eshginfarzali/web3-payment-requests.git
cd web3-payment-requests
npm install
npm run dev        # local blockchain + contracts + web app
```

Open http://localhost:5173 and pick a lesson.

**No install:** on GitHub press **Code → Codespaces → Create codespace**. The container installs
everything, runs `npm run dev` and opens the lab in your browser.

## Testing the rules

```sh
npm test           # 29 contract tests (Hardhat + Chai)
npm run typecheck  # TypeScript for contracts, scripts and the web app
```

Every rule of the meal-voucher system has its own test in
[`test/MealToken.ts`](test/MealToken.ts), for example:

- the issuer cannot mint beyond a company's credit limit;
- employees can only pay registered restaurants; plain ERC20 transfers are disabled;
- only restaurants can redeem; a bank payout can be confirmed only once;
- unused balances can be expired only after the period ends — not even the issuer can do it earlier.

GitHub Actions runs the tests, the type check and the web build on every push.

## How the meal-voucher token works

```
Company ──(bank, off-chain)──▶ Issuer
                                  │ loadAllowance → mint MEAL (limited by credit limit)
                                  ▼
                              Employee ──pay (QR)──▶ Restaurant
                                                         │ redeem → burn MEAL
                                                         ▼
                              Issuer ──(bank payout, off-chain)──▶ Restaurant
                                     confirmPayout records it on-chain
```

- 1 MEAL = 1 AZN of food, 2 decimals.
- `totalLiability() = totalSupply() + pendingPayouts`: what the issuer owes restaurants, visible
  to anyone without trusting the issuer's database.
- Bank transfers happen off-chain; the contract only records them. Connecting real-world events
  to a blockchain is the "oracle problem".

## Project layout

| Path | What |
|---|---|
| `contracts/MealToken.sol` | Meal-voucher token: roles, credit limit, pay, redeem, payouts, period end |
| `contracts/PaymentRequests.sol` | Lesson 1: request / pay / cancel with due dates |
| `contracts/MockUSD.sol` | Lesson 1: freely mintable ERC20 test token |
| `test/` | Contract tests |
| `scripts/dev.mjs` | `npm run dev`: node → deploy → web server |
| `scripts/deploy.ts` | Deploys lesson 1 contracts, writes `web/src/deployments.json` |
| `web/meal.html`, `web/src/meal/` | Lesson 2 UI (the lesson deploys its own MealToken from the browser) |
| `web/payments.html`, `web/src/payments.ts` | Lesson 1 UI |
| `typechain-types/` | Generated TypeScript types for the contracts (by `npm run compile`) |

## Running pieces separately

```sh
npm run node          # local blockchain on :8545
npm run deploy:node   # lesson 1 contracts + 1000 mUSD for accounts 0-4
npm run web           # http://localhost:5173
```

Restarting the node wipes the chain. Lesson 2 notices this and starts over; for lesson 1 run
`deploy:node` again. Lesson 2's last step moves the chain clock forward 31 days, so lesson 1's
due dates may look off afterwards; restart the node for a clean chain.

### Lesson 1 with MetaMask on localhost

1. In MetaMask add the network: RPC `http://127.0.0.1:8545`, chain id `31337`, symbol `ETH`
   (or press "Hardhat Localhost şəbəkəsinə keç" in the page).
2. Import a test account with its private key, printed by `npm run node`.
   These keys are public; never send real funds to them.
3. Choose **MetaMask** in the page and connect.

After restarting the node, MetaMask may show nonce errors: Settings → Advanced →
"Clear activity tab data".

## Deploy lesson 1 to Sepolia

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
same contract. In lesson 1 choose **MetaMask**, switch to Sepolia, and use "+100 test mUSD al"
to mint test tokens.

## Limits

This is a learning project, not production payment software. The meal-voucher model in
particular raises legal questions (e.g. whether such a token counts as e-money) that must be
answered by a lawyer before any real use. A real system would also need privacy review,
monitoring and an independent security audit.
