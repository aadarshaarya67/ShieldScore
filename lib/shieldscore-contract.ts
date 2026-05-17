import { parseAbi } from "viem";

export const SHIELDSCORE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID || 11155111);
export const SHIELDSCORE_ADDRESS = process.env.NEXT_PUBLIC_SHIELDSCORE_ADDRESS as `0x${string}` | undefined;
export const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_DEFAULT_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const shieldScoreAbi = parseAbi([
  "function submitEncryptedSnapshot((uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) balanceConsistency,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) repaymentHistory,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) walletAge,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) protocolDiversity,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) incomeConsistency) returns (bytes32)",
  "function publishScore(uint32 decryptedScore, bytes signature)",
  "function encryptedScoreOf(address account) view returns (bytes32)",
  "function profiles(address account) view returns (uint16 publicScore,uint64 encryptedUpdatedAt,uint64 scorePublishedAt,uint32 snapshotsSubmitted,uint32 loansRepaid,uint32 loansDefaulted,uint256 totalBorrowed,uint256 totalRepaid)",
  "function createPool(uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint32 durationSeconds,uint256 maxLoanAmount) payable returns (uint256)",
  "function fundPool(uint256 poolId) payable",
  "function setPoolActive(uint256 poolId,bool active)",
  "function withdrawAvailable(uint256 poolId,uint256 amount)",
  "function borrow(uint256 poolId,uint256 amount) payable returns (uint256)",
  "function repay(uint256 loanId) payable",
  "function markDefault(uint256 loanId)",
  "function issueScoreAttestation(uint16 threshold) returns (bytes32)",
  "function revokeAttestation(bytes32 attestationId)",
  "function verifyAttestation(bytes32 attestationId,address owner,uint16 threshold) view returns (bool)",
  "function borrowerLoanIds(address borrower) view returns (uint256[])",
  "function ownerAttestationIds(address owner) view returns (bytes32[])",
  "function poolCount() view returns (uint256)",
  "function loanCount() view returns (uint256)",
  "function collateralBpsForScore(uint16 score) pure returns (uint16)",
  "function pools(uint256 poolId) view returns (address lender,uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint32 durationSeconds,uint256 maxLoanAmount,uint256 liquidity,uint256 totalSupplied,uint256 totalBorrowed,uint256 totalRepaid,uint256 interestEarned,uint256 defaultedPrincipal,uint256 borrowerScoreTotal,uint32 loanCount,uint32 defaultCount,bool active)",
  "function loans(uint256 loanId) view returns (uint256 poolId,address borrower,uint256 principal,uint256 collateral,uint256 interest,uint64 startTime,uint64 dueTime,uint8 status)",
  "function attestations(bytes32 attestationId) view returns (address owner,uint16 threshold,uint16 scoreAtIssue,uint64 issuedAt,bool revoked)",
  "function poolHealth(uint256 poolId) view returns (uint16 utilizationBps,uint16 averageScore,uint16 defaultRateBps)",
  "event ScoreAttestationIssued(bytes32 indexed attestationId,address indexed owner,uint16 threshold)",
]);

export type CreditProfile = {
  publicScore: number;
  encryptedUpdatedAt: number;
  scorePublishedAt: number;
  snapshotsSubmitted: number;
  loansRepaid: number;
  loansDefaulted: number;
  totalBorrowed: bigint;
  totalRepaid: bigint;
};

export type LendingPool = {
  id: number;
  lender: `0x${string}`;
  minScore: number;
  baseCollateralBps: number;
  interestBps: number;
  durationSeconds: number;
  maxLoanAmount: bigint;
  liquidity: bigint;
  totalSupplied: bigint;
  totalBorrowed: bigint;
  totalRepaid: bigint;
  interestEarned: bigint;
  defaultedPrincipal: bigint;
  borrowerScoreTotal: bigint;
  loanCount: number;
  defaultCount: number;
  active: boolean;
  utilizationBps: number;
  averageScore: number;
  defaultRateBps: number;
};

export type Loan = {
  id: number;
  poolId: number;
  borrower: `0x${string}`;
  principal: bigint;
  collateral: bigint;
  interest: bigint;
  startTime: number;
  dueTime: number;
  status: number;
};

export type ScoreAttestation = {
  id: `0x${string}`;
  owner: `0x${string}`;
  threshold: number;
  scoreAtIssue: number;
  issuedAt: number;
  revoked: boolean;
};
