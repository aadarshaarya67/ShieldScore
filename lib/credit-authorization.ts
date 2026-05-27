import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export type EncryptedInputLike = {
  ctHash: bigint | string | number;
  securityZone: number;
  utype: number;
  signature: Hex;
};

export type CreditAuthorization = {
  nonce: bigint;
  deadline: number;
  signature: Hex;
};

export const CREDIT_AUTHORIZATION_TYPES = {
  CreditAuthorization: [
    { name: "account", type: "address" },
    { name: "inputsHash", type: "bytes32" },
    { name: "refresh", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function encryptedInputHash(input: EncryptedInputLike) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint8" }, { type: "uint8" }, { type: "bytes32" }],
      [BigInt(input.ctHash), input.securityZone, input.utype, keccak256(input.signature)]
    )
  );
}

export function creditInputsHash(inputs: EncryptedInputLike[]) {
  if (inputs.length !== 5) throw new Error("Credit authorization requires exactly five encrypted inputs");
  const hashes = inputs.map(encryptedInputHash);
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [hashes[0], hashes[1], hashes[2], hashes[3], hashes[4]]
    )
  );
}

export function creditAuthorizationDomain({
  chainId,
  verifyingContract,
}: {
  chainId: number;
  verifyingContract: Address;
}) {
  return {
    name: "ShieldScoreProtocol",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

