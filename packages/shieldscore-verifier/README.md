# @shieldscore/verifier

Tiny viem helper for partner protocols that need to verify ShieldScore threshold attestations without copying ABI fragments through their app.

```ts
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { verifyShieldScoreAttestation } from "@shieldscore/verifier";

const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });

const status = await verifyShieldScoreAttestation({
  client,
  protocolAddress: "0x...",
  attestationId: "0x...",
  owner: "0x...",
  threshold: 700,
});

if (status.valid) {
  // Wallet held a non-revoked score attestation at or above the requested threshold.
}
```

The helper calls `verifyAttestation` and then reads the attestation metadata so integrators can show threshold, issued score, timestamp, and revocation state.
