# ShieldScore Audit Checklist

## FHE And Score Flow

- Confirm every stored ciphertext uses `FHE.allowThis`.
- Confirm publishable final scores use `FHE.allowPublic` and `FHE.verifyDecryptResult`.
- Confirm encrypted snapshots require a valid EIP-712 `CreditAuthorization` from `creditAttester()`.
- Confirm the credit-authorization route derives and encrypts wallet signals server-side instead of signing arbitrary client-provided ciphertext handles.
- Confirm score nonces are consumed exactly once and expired authorizations revert.
- Confirm no raw normalized credit inputs are emitted or stored publicly.
- Review score refresh bounds for repayment boosts, late repayment boosts, and default penalties.
- Confirm stale scores cannot borrow after repayment/default activity or after `SCORE_VALIDITY`.

## Lending Pools

- Native and ERC-20 pool accounting stays separated by `asset`.
- ERC-20 pool creation is limited to owner-approved asset policies.
- Lender-supplied ERC-20 collateral prices must match the approved asset policy.
- ERC-20 transfers use `SafeERC20` and balance-delta accounting.
- ERC-20 repayments revert if fee-on-transfer behavior results in less than the loan payoff entering the protocol.
- Token loans use native ETH collateral priced by lender-set `collateralPriceWei`.
- Repayment, default, recovered collateral withdrawal, and lender liquidity withdrawal are non-reentrant.
- `LoanBorrowed`, `LoanRepaid`, and `LoanDefaulted` events include `poolId` for indexer attribution.

## Governance And Safety

- Guardian can pause, owner alone can unpause.
- Pool terms enforce score, collateral, interest, duration, liquidity, and max-loan bounds.
- Keeper can mark overdue loans but cannot withdraw funds.
- Revocation and attestation verification remain available for integrator safety.

## Mainnet Readiness

- Replace test USDC with audited production assets.
- Add an oracle or governance-approved collateral price process before real value.
- Set RPC rate limits and event-indexer start blocks.
- Verify deployed bytecode matches the audited artifact before switching the frontend address.
- Complete external review for FHE access control, token accounting, and emergency paths.
