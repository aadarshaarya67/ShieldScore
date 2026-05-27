# ShieldScore Roadmap

## Finished In This Build

- Encrypted score submission with five normalized borrower signals.
- FHE weighted score computation in Solidity.
- CoFHE decrypt-for-transaction verification before score publication.
- Lender-created pools with thresholds, interest, duration, liquidity, collateral caps, lender-only funding, pause, and withdrawal.
- Borrow, repay, default, collateral recovery, pool health, and borrower history accounting.
- Threshold score attestations with revoke and verify helpers.
- Next.js app console and branded landing page using the existing template motion language.
- Hardhat contract tests with CoFHE mock contracts.
- ERC-20 lending pools with ssUSDC test token deployment, approvals, token funding, token repayment, and native collateral pricing.
- Wallet/protocol activity ingestion, encrypted score refresh, on-chain score history, charts, and category trends.
- Credit-attester authorization, per-wallet score nonces, and stale-score borrow protection.
- Event indexing, lender analytics, transaction toasts/history, keeper automation, guardian pause, and audit/runbook docs.
- External verifier helper package for integrators.

## Deployment Status

- The Wave 5 Sepolia deployment is live at `0xc40Ed7d0Bf781e5D9D9AAEC307cBc5D3d633f9D4`.
- The current hardened source is deployed on Sepolia and seeded with native ETH plus ssUSDC pools.
- The deployed ssUSDC asset is owner-approved with a fixed collateral price policy.

## Next Milestones

1. Keep the Sepolia deployer funded for pool maintenance, keeper runs, and redeploys.
2. Replace ssUSDC with production-approved assets.
3. Add a production oracle or governance process for token collateral pricing.
4. Move the browser event indexer behind a hosted indexer for high-traffic use.
5. Complete third-party audit and mainnet launch review.
6. Add keeper alert delivery through the chosen monitoring provider.
