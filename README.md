# ShieldScore

ShieldScore is a privacy-preserving on-chain credit protocol for DeFi lending. It lets a borrower generate a credit score from encrypted financial signals, then use that score to access lender-created loan pools with lower collateral requirements. Raw borrower data never becomes public; only the final verified score is published for lending decisions.

Live app: https://shieldscore-phi.vercel.app

## What The App Does

ShieldScore solves one of DeFi's biggest limits: most lending is overcollateralized because smart contracts cannot safely judge borrower quality from private financial data. ShieldScore uses CoFHE/Fhenix so the protocol can compute over encrypted inputs and reveal only the final 300-850 score.

The app supports three main users:

- Borrowers generate an encrypted score, browse pools they qualify for, borrow native testnet ETH, repay loans, and issue threshold score attestations.
- Lenders create score-gated pools, set collateral and interest terms, fund liquidity, pause pools, withdraw available liquidity, and monitor pool risk.
- Integrators can verify score attestations to check whether a wallet met a score threshold without needing the borrower's full profile.

## How It Works

1. A borrower connects a wallet and submits five normalized credit signals: balance consistency, repayment history, wallet age, protocol diversity, and income consistency.
2. The browser encrypts those values with the CoFHE SDK before the transaction is sent.
3. `ShieldScoreProtocol.sol` computes a weighted score over encrypted values using `FHE.sol`.
4. The borrower requests a CoFHE decrypt-for-transaction result for the final score.
5. The contract verifies the decrypt signature before publishing the score.
6. Lender pools enforce minimum score thresholds, max loan size, duration, interest, and collateral policy on-chain.
7. Borrow, repay, default, pool funding, pool withdrawal, and score attestations all execute through the deployed contract.

## Shipped Features

- Encrypted credit scoring with CoFHE and FHE arithmetic.
- Verified final score publication with decrypt-for-transaction signature checks.
- Score-gated native ETH lending pools.
- Tiered collateral policy based on published score.
- Borrow, repay, overdue default marking, collateral recovery, and repayment accounting.
- Lender pool creation, lender-only funding, pause/reactivation, and liquidity withdrawal.
- Pool health metrics: utilization, average borrower score, default rate, and interest earned.
- Score threshold attestations with on-chain verify and revoke helpers.
- Separate frontend pages for every core flow:
  - `/dashboard`
  - `/score`
  - `/marketplace`
  - `/create-pool`
  - `/repayments`
  - `/attestations`
  - `/risk`
- Branded landing page using the original animated template style.
- Hardhat tests with CoFHE mocks for scoring, borrow, repay, default, and attestation flows.
- Production Vercel deployment wired to the live Sepolia contract.

## Current Deployment

- Network: Sepolia (`11155111`)
- Contract: `0x5c43FC4b3765dAa943d0bF58B765C46BFa304132`
- App: https://shieldscore-phi.vercel.app
- Vercel project: `nikkus-projects-d0d225f5/shieldscore`
- Seeded pools:
  - Pool 1: score `650+`, `40%` collateral cap, `12%` interest, `0.01 ETH` max loan
  - Pool 2: score `720+`, `25%` collateral cap, `9%` interest, `0.008 ETH` max loan
  - Pool 3: score `800+`, `12%` collateral cap, `6.5%` interest, `0.005 ETH` max loan

## Setup

```bash
npm install
cp .env.example .env.local
```

Set the public app environment:

```bash
NEXT_PUBLIC_SHIELDSCORE_ADDRESS=0x5c43FC4b3765dAa943d0bF58B765C46BFa304132
NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID=11155111
NEXT_PUBLIC_DEFAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Keep deployer keys in `.env`, not `.env.local`:

```bash
PRIVATE_KEY=0x...
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run compile
npm run test:contracts
npm run deploy:sepolia
npm run seed:sepolia
```

## Verification Status

The current build was checked with:

- `npm run compile`
- `npm run test:contracts`
- `npm run typecheck -- --pretty false`
- `npm run build`
- Direct Sepolia RPC reads for pool and loan state
- A scripted Sepolia smoke test for encrypted score publish, attestation, pool pause/reactivation, fund/withdraw, borrow, and repay
- Vercel production route checks for all shipped pages

## Wave 5

Wave 5 is the next production-hardening pass. These are the missing or incomplete items found during the final app review:

1. ERC-20 lending pools
   Native ETH pools work today, but the user story talks about USDC-style lending. Wave 5 should add ERC-20 pool accounting, token approvals, token decimals, and a USDC test token deployment.

2. Real credit data ingestion
   The current score form uses user-controlled normalized inputs. Wave 5 should add wallet history indexing, protocol activity scoring, repayment import, and client-side normalization before encryption.

3. Automatic score refresh
   Repayments are recorded on-chain, but they do not automatically feed into a new encrypted score. Wave 5 should add a score refresh flow that incorporates successful repayments, late repayments, and defaults.

4. Score history and charts
   The dashboard shows current profile counters, but it does not yet show score history over time. Wave 5 should add score history events, charting, and category trend views.

5. Attestation management UI
   The contract supports revocation and verification, but the UI currently focuses on issuing/copying attestations. Wave 5 should add revoke buttons, verify-by-id forms, and shareable attestation links.

6. Lender analytics
   Pool health exists, but analytics are still simple. Wave 5 should add utilization history, cohort default curves, expected yield, borrower score bands, and pool-level event timelines.

7. Better transaction UX
   Add gas estimation, wallet balance checks, explorer links, pending transaction toasts, clearer revert messages, and transaction history per wallet.

8. Default automation
   Defaults can be marked after due date, but there is no watcher or keeper. Wave 5 should add an automation path for overdue loans and lender alerts.

9. Protocol safety controls
   Add a guardian/emergency pause, stricter parameter bounds, deployment monitoring, and a formal audit checklist before any mainnet move.

10. External integration package
    Build a small verifier helper package and docs so partner protocols can verify score attestations without copying ABI details manually.

11. Production data layer
    Add event indexing for pools, loans, repayments, defaults, and attestations. This will make the UI faster and remove reliance on scanning contract reads from the browser.

12. Mainnet readiness
    Prepare deployment runbooks, monitoring dashboards, incident response notes, rate limits for public RPC usage, and a security review of the FHE/decrypt flow.

## Notes

- The app is fully wired to Sepolia for the current native ETH testnet version.
- CoFHE/Hardhat install warnings are from the latest published CoFHE tooling dependency chain and do not block the deployed frontend.
- Webpack reports circular chunk warnings from CoFHE SDK bundling; the production build still completes and deploys successfully.
