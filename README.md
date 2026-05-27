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

1. A borrower connects a wallet and requests five normalized credit signals: balance consistency, repayment history, wallet age, protocol diversity, and income consistency.
2. `/api/credit-authorization` derives those signals from on-chain wallet and protocol activity, encrypts them with CoFHE, and signs the encrypted input handles.
3. `ShieldScoreProtocol.sol` computes a weighted score over encrypted values using `FHE.sol`.
4. The borrower requests a CoFHE decrypt-for-transaction result for the final score.
5. The contract verifies the decrypt signature before publishing the score.
6. Lender pools enforce minimum score thresholds, max loan size, duration, interest, and collateral policy on-chain.
7. Borrow, repay, default, pool funding, pool withdrawal, and score attestations all execute through the deployed contract.

## Shipped Features

- Encrypted credit scoring with CoFHE and FHE arithmetic.
- EIP-712 credit authorization from a configured credit attester before encrypted snapshots are accepted.
- Verified final score publication with decrypt-for-transaction signature checks.
- Score freshness checks that force a refresh after repayments, defaults, or 30 days.
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
- Production Vercel deployment target documented for the live Sepolia contract.
- Production `/api/health` endpoint for curl/Vercel monitoring of RPC, contract bytecode, Wave 5 ABI support, ssUSDC bytecode, and server-side credit-attester readiness.

## Current Deployment

- Status: Wave 5 protocol deployed and seeded on Sepolia testnet. Configure `CREDIT_ATTESTER_PRIVATE_KEY` server-side so `/api/credit-authorization` can sign encrypted score submissions.
- Network: Sepolia (`11155111`)
- Contract: `0xc40Ed7d0Bf781e5D9D9AAEC307cBc5D3d633f9D4`
- Test USDC: `0xa3b7eCF895844b4BfC40FdD151A8D856F4D5174a`
- Start block: `10933745`
- App: https://shieldscore-phi.vercel.app
- Vercel project: `nikkus-projects-d0d225f5/shieldscore`
- Health: `/api/health` returns `ok` when the deployed environment has the server-side credit attester key configured.
- Seeded pools:
  - Pool 1: score `650+`, `40%` collateral cap, `12%` interest, `0.001 ETH` max loan
  - Pool 2: score `720+`, `25%` collateral cap, `9%` interest, `0.0008 ETH` max loan
  - Pool 3: score `800+`, `12%` collateral cap, `6.5%` interest, `0.0005 ETH` max loan
  - Pool 4: score `680+`, `35%` collateral cap, `9.5%` interest, `250 ssUSDC` max loan
  - Pool 5: score `760+`, `18%` collateral cap, `7%` interest, `150 ssUSDC` max loan

## Setup

```bash
npm install
cp .env.example .env.local
```

Set the public app environment:

```bash
NEXT_PUBLIC_SHIELDSCORE_ADDRESS=0xc40Ed7d0Bf781e5D9D9AAEC307cBc5D3d633f9D4
NEXT_PUBLIC_SHIELDSCORE_USDC_ADDRESS=0xa3b7eCF895844b4BfC40FdD151A8D856F4D5174a
NEXT_PUBLIC_SHIELDSCORE_START_BLOCK=10933745
NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID=11155111
NEXT_PUBLIC_DEFAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Keep deployer keys in `.env`, not `.env.local`:

```bash
PRIVATE_KEY=0x...
CREDIT_ATTESTER_PRIVATE_KEY=0x...
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

`CREDIT_ATTESTER_PRIVATE_KEY` is server-only. The app uses it in `/api/credit-authorization` after deriving and encrypting wallet signals for the connected borrower, then signs that encrypted-input handle set. It must resolve to the contract's `creditAttester()` address, and it must never be exposed with a `NEXT_PUBLIC_` prefix.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run compile
npm run test:contracts
npm run deploy:sepolia
npm run seed:sepolia
npm run keeper:sepolia
```

## Endpoint Checks

Run these after `npm run build && npm run start -- -p 3011`:

```bash
curl -i http://localhost:3011/
curl -i http://localhost:3011/dashboard
curl -i http://localhost:3011/score
curl -i http://localhost:3011/marketplace
curl -i http://localhost:3011/create-pool
curl -i http://localhost:3011/repayments
curl -i http://localhost:3011/attestations
curl -i http://localhost:3011/risk
curl -i http://localhost:3011/api/health
curl -i -X POST http://localhost:3011/api/credit-authorization \
  -H "Content-Type: application/json" \
  -d '{"account":"0x0000000000000000000000000000000000000001","refresh":false}'
```

Expected with production env configured: pages return `200`, `/api/health` returns `ok`, `attester.keyMatchesContract` is `true`, and score generation works from `/score` with a connected wallet. If `CREDIT_ATTESTER_PRIVATE_KEY` is missing, `/api/health` reports `attention` and `/api/credit-authorization` refuses to sign.

## Vercel Production Env

Set public env values for the deployed contract and keep the credit attester server-only:

```bash
vercel env add NEXT_PUBLIC_SHIELDSCORE_ADDRESS production
vercel env add NEXT_PUBLIC_SHIELDSCORE_USDC_ADDRESS production
vercel env add NEXT_PUBLIC_SHIELDSCORE_START_BLOCK production
vercel env add NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID production
vercel env add NEXT_PUBLIC_DEFAULT_RPC_URL production
vercel env add CREDIT_ATTESTER_PRIVATE_KEY production
```

Do not add `CREDIT_ATTESTER_PRIVATE_KEY` with a `NEXT_PUBLIC_` prefix. After changing env values, redeploy with `vercel --prod` and check `https://<deployment>/api/health`.

## Verification Status

The current build was checked with:

- `npm run compile`
- `npm run test:contracts`
- `npm run typecheck`
- `npm run build`
- `npm audit --omit=dev` for dependency-advisory triage
- curl checks for every public page plus `/api/health` and `/api/credit-authorization`
- Production-server smoke test on `http://localhost:3011` for dashboard, score, marketplace, create pool, repayments, attestations, and risk routes.

The current Sepolia deployment was checked with direct Sepolia RPC reads, curl checks, and local production-server route/API smoke tests. Contract behavior is covered by the Hardhat CoFHE mock suite for encrypted score publish, native and ERC-20 pools, borrow, repay, refresh, attestation, pause, and default flows.

## Wave 5

Wave 5 is now implemented as the production-hardening release:

1. ERC-20 lending pools
   Added ERC-20 pool accounting, approval UX, token decimals, ssUSDC test token deployment, token funding, token repayment, and native ETH collateral pricing for token loans.

2. Real credit data ingestion
   Added wallet/protocol ingestion from balance, transaction count, ShieldScore event history, repayments, defaults, and pool diversity, then normalizes those signals before encryption.

3. Trusted score authorization
   Added a server-side credit attester, per-wallet nonces, EIP-712 signatures over encrypted input handles, and contract-side signature verification before encrypted score submissions are accepted.

4. Automatic score refresh
   Added encrypted refresh snapshots with on-chain repayment/default adjustment bounds for successful, late, and defaulted repayment history.

5. Score history and charts
   Added on-chain score history entries, `ScorePublished` snapshot events, dashboard score charts, and category trend charts.

6. Attestation management UI
   Added revoke buttons, verify-by-id form, and shareable `/attestations?id=...` links.

7. Lender analytics
   Added expected yield, active principal, recovered collateral, cohort default charts, and pool event timelines.

8. Better transaction UX
   Added gas estimation, native balance checks, explorer links, pending/confirmed toasts, clearer revert messages, and wallet transaction history.

9. Default automation
   Added `scripts/keeper.cjs` plus `npm run keeper:sepolia` to scan overdue active loans and mark defaults.

10. Protocol safety controls
    Added guardian emergency pause, owner-only unpause, owner-approved ERC-20 asset policies, stricter pool bounds, recovered collateral controls, score freshness, and audit checklist docs.

11. External integration package
    Added `packages/shieldscore-verifier` with a viem helper for attestation verification.

12. Production data layer
    Added event indexing for scores, pools, loans, repayments, defaults, attestations, pauses, withdrawals, and recovered collateral.

13. Production health checks
    Added `/api/health` so deployments can verify RPC connectivity, contract code, Wave 5 ABI support, ssUSDC code, and attester configuration with a single curl command.

14. Mainnet readiness
    Added `docs/PRODUCTION_RUNBOOK.md` and `docs/AUDIT_CHECKLIST.md` with deployment, keeper, monitoring, incident, and FHE/security review notes.

## Notes

- The app is wired for Sepolia testnet. Production deployments must set `CREDIT_ATTESTER_PRIVATE_KEY` as a server-only environment variable matching the deployed contract's `creditAttester()`.
- `npm audit --omit=dev` still reports Hardhat 2 transitive advisories because the latest `@cofhe/sdk` peers into the Hardhat 2 toolchain. Do not force Hardhat 3 without validating CoFHE plugin compatibility.
- Webpack reports circular chunk warnings from CoFHE SDK bundling; the production build still completes and deploys successfully.

