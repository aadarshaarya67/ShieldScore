import { parseAbi } from "viem";

export const SHIELDSCORE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_SHIELDSCORE_CHAIN_ID || 11155111);
export const SHIELDSCORE_ADDRESS = process.env.NEXT_PUBLIC_SHIELDSCORE_ADDRESS as `0x${string}` | undefined;
export const SHIELDSCORE_USDC_ADDRESS = process.env.NEXT_PUBLIC_SHIELDSCORE_USDC_ADDRESS as `0x${string}` | undefined;
export const SHIELDSCORE_START_BLOCK = process.env.NEXT_PUBLIC_SHIELDSCORE_START_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_SHIELDSCORE_START_BLOCK)
  : undefined;
export const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_DEFAULT_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
export const NATIVE_ASSET = "0x0000000000000000000000000000000000000000" as const;

export const shieldScoreAbi = parseAbi([
  "function submitEncryptedSnapshot((uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) balanceConsistency,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) repaymentHistory,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) walletAge,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) protocolDiversity,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) incomeConsistency,(uint256 nonce,uint64 deadline,bytes signature) authorization) returns (bytes32)",
  "function submitEncryptedRefreshSnapshot((uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) balanceConsistency,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) repaymentHistory,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) walletAge,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) protocolDiversity,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) incomeConsistency,(uint256 nonce,uint64 deadline,bytes signature) authorization) returns (bytes32)",
  "function publishScore(uint32 decryptedScore, bytes signature)",
  "function encryptedScoreOf(address account) view returns (bytes32)",
  "function profiles(address account) view returns (uint16 publicScore,uint64 encryptedUpdatedAt,uint64 scorePublishedAt,uint64 creditActivityUpdatedAt,uint32 snapshotsSubmitted,uint32 loansRepaid,uint32 loansRepaidLate,uint32 loansDefaulted,int16 lastRefreshAdjustment,uint256 totalBorrowed,uint256 totalRepaid)",
  "function scoreHistoryOf(address account) view returns ((uint16 score,uint64 publishedAt,uint32 snapshotNumber,int16 activityAdjustment,bool refresh)[])",
  "function creditInputsHash((uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) balanceConsistency,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) repaymentHistory,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) walletAge,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) protocolDiversity,(uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) incomeConsistency) pure returns (bytes32)",
  "function createPool(uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint32 durationSeconds,uint256 maxLoanAmount) payable returns (uint256)",
  "function createErc20Pool(address asset,uint256 collateralPriceWei,uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint32 durationSeconds,uint256 maxLoanAmount,uint256 initialLiquidity) returns (uint256)",
  "function fundPool(uint256 poolId) payable",
  "function fundErc20Pool(uint256 poolId,uint256 amount)",
  "function setPoolActive(uint256 poolId,bool active)",
  "function setAssetPolicy(address asset,bool approved,uint256 collateralPriceWei)",
  "function withdrawAvailable(uint256 poolId,uint256 amount)",
  "function withdrawRecoveredCollateral(uint256 poolId,uint256 amount)",
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
  "function scoreNonces(address account) view returns (uint256)",
  "function creditAttester() view returns (address)",
  "function guardian() view returns (address)",
  "function assetPolicies(address asset) view returns (bool approved,uint256 collateralPriceWei)",
  "function paused() view returns (bool)",
  "function SCORE_VALIDITY() view returns (uint64)",
  "function collateralBpsForScore(uint16 score) pure returns (uint16)",
  "function scoreRefreshAdjustment(address account) view returns (int16)",
  "function requiredCollateralFor(uint256 poolId,uint256 amount,uint16 score) view returns (uint256)",
  "function pools(uint256 poolId) view returns (address lender,address asset,uint8 assetDecimals,uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint32 durationSeconds,uint256 collateralPriceWei,uint256 maxLoanAmount,uint256 liquidity,uint256 totalSupplied,uint256 totalBorrowed,uint256 totalRepaid,uint256 interestEarned,uint256 defaultedPrincipal,uint256 recoveredCollateral,uint256 borrowerScoreTotal,uint32 loanCount,uint32 defaultCount,bool active)",
  "function loans(uint256 loanId) view returns (uint256 poolId,address borrower,uint256 principal,uint256 collateral,uint256 interest,uint64 startTime,uint64 dueTime,uint8 status)",
  "function attestations(bytes32 attestationId) view returns (address owner,uint16 threshold,uint16 scoreAtIssue,uint64 issuedAt,bool revoked)",
  "function poolHealth(uint256 poolId) view returns (uint16 utilizationBps,uint16 averageScore,uint16 defaultRateBps)",
  "function poolAnalytics(uint256 poolId) view returns (uint16 utilizationBps,uint16 averageScore,uint16 defaultRateBps,uint16 expectedYieldBps,uint256 activePrincipal,uint256 availableLiquidity,uint256 interestEarned,uint256 defaultedPrincipal,uint256 recoveredCollateral)",
  "event EncryptedSnapshotSubmitted(address indexed account,bytes32 indexed encryptedScoreHandle)",
  "event EncryptedRefreshSubmitted(address indexed account,bytes32 indexed encryptedScoreHandle,int16 activityAdjustment)",
  "event ScorePublished(address indexed account,uint16 score,uint32 indexed snapshotNumber)",
  "event PoolCreated(uint256 indexed poolId,address indexed lender,uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint256 supplied)",
  "event TokenPoolCreated(uint256 indexed poolId,address indexed lender,address indexed asset,uint8 assetDecimals,uint256 collateralPriceWei,uint16 minScore,uint16 baseCollateralBps,uint16 interestBps,uint256 supplied)",
  "event PoolFunded(uint256 indexed poolId,address indexed lender,uint256 amount)",
  "event PoolPaused(uint256 indexed poolId,bool active)",
  "event PoolWithdrawn(uint256 indexed poolId,address indexed lender,uint256 amount)",
  "event RecoveredCollateralWithdrawn(uint256 indexed poolId,address indexed lender,uint256 amount)",
  "event LoanBorrowed(uint256 indexed loanId,uint256 indexed poolId,address indexed borrower,uint256 principal,uint256 collateral,address asset)",
  "event LoanRepaid(uint256 indexed loanId,uint256 indexed poolId,address indexed borrower,uint256 principal,uint256 interest,address asset)",
  "event LoanDefaulted(uint256 indexed loanId,uint256 indexed poolId,address indexed borrower,uint256 recoveredCollateral)",
  "event ScoreAttestationIssued(bytes32 indexed attestationId,address indexed owner,uint16 threshold)",
  "event ScoreAttestationRevoked(bytes32 indexed attestationId,address indexed owner)",
  "event GuardianUpdated(address indexed guardian)",
  "event EmergencyPauseSet(address indexed caller,bool paused)",
  "event CreditAttesterUpdated(address indexed creditAttester)",
  "event AssetPolicyUpdated(address indexed asset,bool approved,uint256 collateralPriceWei)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function faucet()",
  "function symbol() view returns (string)",
]);

export type CreditProfile = {
  publicScore: number;
  encryptedUpdatedAt: number;
  scorePublishedAt: number;
  creditActivityUpdatedAt: number;
  snapshotsSubmitted: number;
  loansRepaid: number;
  loansRepaidLate: number;
  loansDefaulted: number;
  lastRefreshAdjustment: number;
  totalBorrowed: bigint;
  totalRepaid: bigint;
};

export type ScoreHistoryEntry = {
  score: number;
  publishedAt: number;
  snapshotNumber: number;
  activityAdjustment: number;
  refresh: boolean;
};

export type LendingPool = {
  id: number;
  lender: `0x${string}`;
  asset: `0x${string}`;
  assetDecimals: number;
  minScore: number;
  baseCollateralBps: number;
  interestBps: number;
  durationSeconds: number;
  collateralPriceWei: bigint;
  maxLoanAmount: bigint;
  liquidity: bigint;
  totalSupplied: bigint;
  totalBorrowed: bigint;
  totalRepaid: bigint;
  interestEarned: bigint;
  defaultedPrincipal: bigint;
  recoveredCollateral: bigint;
  borrowerScoreTotal: bigint;
  loanCount: number;
  defaultCount: number;
  active: boolean;
  utilizationBps: number;
  averageScore: number;
  defaultRateBps: number;
  expectedYieldBps: number;
  activePrincipal: bigint;
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
