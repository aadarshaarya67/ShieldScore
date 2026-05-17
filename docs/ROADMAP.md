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

## Next Milestones

1. ERC-20 lending pools with USDC-style decimals and token approval UX.
2. Score refresh automation from real borrower activity snapshots.
3. Lender analytics with cohort default curves and utilization history.
4. External verifier package for score attestations.
5. Security audit pass, pause/guardian controls, and deployment monitoring.
