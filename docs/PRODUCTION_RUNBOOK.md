# ShieldScore Production Runbook

## Deployment

1. Compile and test:
   `npm run compile && npm run test:contracts && npm run typecheck && npm run build`
2. Fund the deployer with enough testnet ETH for the protocol, ssUSDC, and seed transactions.
3. Configure server-only keys:
   `PRIVATE_KEY=... CREDIT_ATTESTER_PRIVATE_KEY=...`
4. Deploy protocol and test USDC:
   `npm run deploy:sepolia`
5. Confirm `creditAttester()` equals the public address of `CREDIT_ATTESTER_PRIVATE_KEY`.
6. Confirm the deployed ssUSDC asset policy is approved:
   `assetPolicies(<ssUSDC address>)` should return `approved=true` and the expected collateral price.
7. Seed demo pools:
   `PRIVATE_KEY=... npm run seed:sepolia`
8. Set frontend env:
   `NEXT_PUBLIC_SHIELDSCORE_ADDRESS`, `NEXT_PUBLIC_SHIELDSCORE_USDC_ADDRESS`, `NEXT_PUBLIC_SHIELDSCORE_START_BLOCK`, `NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID`, `NEXT_PUBLIC_DEFAULT_RPC_URL`
9. Set backend env for the deployed app:
   `CREDIT_ATTESTER_PRIVATE_KEY`
10. Check `/api/health`; it should return `ok`, `attester.keyMatchesContract: true`, and `usdc.policyApproved: true`.
11. Run route and transaction smoke tests before judging or public demos.
12. Compare deployed bytecode with the compiled artifact before calling the release production-ready.

## Credit Attester

- `/api/credit-authorization` derives wallet/protocol signals, encrypts them with CoFHE, and signs EIP-712 authorizations for those encrypted input handles.
- `CREDIT_ATTESTER_PRIVATE_KEY` controls the signing wallet for that route.
- The signing wallet must match `ShieldScoreProtocol.creditAttester()`, otherwise the API refuses to sign.
- The production API intentionally requires `CREDIT_ATTESTER_PRIVATE_KEY`; it does not fall back to deployer keys.
- Rotate the signer with `setCreditAttester(address)` from the owner wallet and immediately update the server secret.
- Keep the attester key off the client; never expose it through a `NEXT_PUBLIC_` variable.

## Operations

- Run `npm run keeper:sepolia` on a scheduled runner to mark overdue loans.
- Watch `EmergencyPauseSet`, `LoanDefaulted`, `PoolPaused`, `RecoveredCollateralWithdrawn`, and failed keeper logs.
- Keep a funded guardian wallet separate from the deployer owner wallet.
- Watch `/api/credit-authorization` error rates; signer mismatch or RPC failures block new score submissions.
- Watch `/api/health`; `degraded` means RPC, deployment, ABI, ssUSDC, or attester configuration needs attention.
- Rotate public RPC providers or add rate-limited private RPCs before high-traffic demos.

## Incident Response

- Guardian pauses immediately with `emergencyPause` when a pool or scoring issue is suspected.
- Owner unpauses only after contract state, pool liquidity, token balances, and pending loans are reviewed.
- Publish a short incident note with affected pool ids, loan ids, and transaction hashes.
- For frontend RPC degradation, switch `NEXT_PUBLIC_DEFAULT_RPC_URL` and redeploy.
- For credit-attester compromise, pause the protocol, rotate `creditAttester`, rotate the server secret, then unpause after a signed-score smoke test.
