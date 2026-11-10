# Fintech payment demo

Educational dApp prototype for a simple payment-request flow. It uses a freely mintable
`mUSD` test token and Hardhat's temporary local blockchain. It does not connect to a bank
and does not use real money.

## What it demonstrates

1. A merchant creates a request for a specific payer, token, and amount.
2. The payer approves the payment contract to spend the requested test tokens.
3. The payer pays the request; the contract transfers tokens to the merchant and marks
   the request as paid.

The invoice reference is represented by a hash. Do not put personal or confidential
information directly on a public blockchain.

## Run locally

```sh
npm install
npm test
npm run deploy:local
```

`deploy:local` deploys to an ephemeral Hardhat network. The displayed contract addresses
are temporary and are not deployed to a public network.

## Web demo

Run each command in its own terminal:

```sh
npm run node          # persistent local blockchain on :8545
npm run deploy:node   # deploy contracts, mint 1000 mUSD to accounts 0-4, write web/config.json
npm run web           # demo page on http://localhost:5173
```

Pick an account, create a request for another account, switch to the payer account and
click "Ödə" (pay). The page signs with Hardhat's unlocked test accounts, so no wallet is
needed. Restarting `npm run node` wipes the chain; run `deploy:node` again afterwards.

This is a learning project, not production payment software. A real system would need
careful token allowlisting, legal and privacy review, wallet UX, monitoring, and an
independent security audit.
