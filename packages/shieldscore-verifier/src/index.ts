import { parseAbi, type Address, type PublicClient } from "viem";

export const shieldScoreVerifierAbi = parseAbi([
  "function verifyAttestation(bytes32 attestationId,address owner,uint16 threshold) view returns (bool)",
  "function attestations(bytes32 attestationId) view returns (address owner,uint16 threshold,uint16 scoreAtIssue,uint64 issuedAt,bool revoked)",
]);

export type ShieldScoreAttestationStatus = {
  valid: boolean;
  owner: Address;
  threshold: number;
  scoreAtIssue: number;
  issuedAt: number;
  revoked: boolean;
};

export async function verifyShieldScoreAttestation({
  client,
  protocolAddress,
  attestationId,
  owner,
  threshold,
}: {
  client: PublicClient;
  protocolAddress: Address;
  attestationId: `0x${string}`;
  owner: Address;
  threshold: number;
}): Promise<ShieldScoreAttestationStatus> {
  const [valid, tuple] = await Promise.all([
    client.readContract({
      address: protocolAddress,
      abi: shieldScoreVerifierAbi,
      functionName: "verifyAttestation",
      args: [attestationId, owner, threshold],
    }),
    client.readContract({
      address: protocolAddress,
      abi: shieldScoreVerifierAbi,
      functionName: "attestations",
      args: [attestationId],
    }),
  ]);

  return {
    valid,
    owner: tuple[0],
    threshold: Number(tuple[1]),
    scoreAtIssue: Number(tuple[2]),
    issuedAt: Number(tuple[3]),
    revoked: tuple[4],
  };
}
