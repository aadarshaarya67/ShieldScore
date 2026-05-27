import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import { shieldScoreAbi, SHIELDSCORE_START_BLOCK, type Loan, type ScoreHistoryEntry } from "./shieldscore-contract";

export type IndexedProtocolEvent = {
  type:
    | "score"
    | "pool"
    | "fund"
    | "pause"
    | "withdraw"
    | "borrow"
    | "repay"
    | "default"
    | "attestation"
    | "revoke"
    | "collateral";
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp: number;
  account?: Address;
  poolId?: number;
  loanId?: number;
  score?: number;
  snapshotNumber?: number;
  amount?: bigint;
  label: string;
};

export type PoolAnalyticsPoint = {
  poolId: number;
  utilizationBps: number;
  defaultRateBps: number;
  expectedYieldBps: number;
  timestamp: number;
};

export type IndexedProtocolData = {
  events: IndexedProtocolEvent[];
  scoreHistory: ScoreHistoryEntry[];
  poolTimeline: IndexedProtocolEvent[];
  repaymentEvents: IndexedProtocolEvent[];
  defaultEvents: IndexedProtocolEvent[];
  utilizationHistory: PoolAnalyticsPoint[];
};

const EVENT_NAMES = [
  "ScorePublished",
  "PoolCreated",
  "TokenPoolCreated",
  "PoolFunded",
  "PoolPaused",
  "PoolWithdrawn",
  "RecoveredCollateralWithdrawn",
  "LoanBorrowed",
  "LoanRepaid",
  "LoanDefaulted",
  "ScoreAttestationIssued",
  "ScoreAttestationRevoked",
] as const;

const DEFAULT_LOOKBACK_BLOCKS = 120_000n;

function sameAddress(left?: string, right?: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return getAddress(value) as Address;
  } catch {
    return undefined;
  }
}

function eventLabel(name: string, args: Record<string, unknown>) {
  if (name === "ScorePublished") return `Score ${String(args.score)} published`;
  if (name === "PoolCreated") return `Native pool ${String(args.poolId)} created`;
  if (name === "TokenPoolCreated") return `ERC-20 pool ${String(args.poolId)} created`;
  if (name === "PoolFunded") return `Pool ${String(args.poolId)} funded`;
  if (name === "PoolPaused") return `Pool ${String(args.poolId)} ${args.active ? "reactivated" : "paused"}`;
  if (name === "PoolWithdrawn") return `Pool ${String(args.poolId)} liquidity withdrawn`;
  if (name === "RecoveredCollateralWithdrawn") return `Pool ${String(args.poolId)} collateral recovered`;
  if (name === "LoanBorrowed") return `Loan ${String(args.loanId)} borrowed`;
  if (name === "LoanRepaid") return `Loan ${String(args.loanId)} repaid`;
  if (name === "LoanDefaulted") return `Loan ${String(args.loanId)} defaulted`;
  if (name === "ScoreAttestationIssued") return `Attestation issued`;
  if (name === "ScoreAttestationRevoked") return `Attestation revoked`;
  return name;
}

function eventType(name: string): IndexedProtocolEvent["type"] {
  if (name === "ScorePublished") return "score";
  if (name === "PoolCreated" || name === "TokenPoolCreated") return "pool";
  if (name === "PoolFunded") return "fund";
  if (name === "PoolPaused") return "pause";
  if (name === "PoolWithdrawn") return "withdraw";
  if (name === "RecoveredCollateralWithdrawn") return "collateral";
  if (name === "LoanBorrowed") return "borrow";
  if (name === "LoanRepaid") return "repay";
  if (name === "LoanDefaulted") return "default";
  if (name === "ScoreAttestationIssued") return "attestation";
  return "revoke";
}

async function blockTimestamps(client: PublicClient, blockNumbers: bigint[]) {
  const unique = Array.from(new Set(blockNumbers.map((block) => block.toString()))).map(BigInt);
  const entries = await Promise.all(
    unique.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      return [blockNumber.toString(), Number(block.timestamp)] as const;
    })
  );
  return new Map(entries);
}

export async function indexShieldScoreEvents({
  client,
  address,
  account,
  poolCount,
}: {
  client: PublicClient;
  address: Address;
  account?: Address;
  poolCount: number;
}): Promise<IndexedProtocolData> {
  const latest = await client.getBlockNumber();
  const fromBlock = SHIELDSCORE_START_BLOCK ?? (latest > DEFAULT_LOOKBACK_BLOCKS ? latest - DEFAULT_LOOKBACK_BLOCKS : 0n);
  const logs = (
    await Promise.all(
      EVENT_NAMES.map((eventName) =>
        client.getContractEvents({
          address,
          abi: shieldScoreAbi,
          eventName,
          fromBlock,
          toBlock: latest,
        } as any)
      )
    )
  ).flat();
  type ChainEventLog = (typeof logs)[number] & { blockNumber: bigint; transactionHash: `0x${string}` };
  const chainLogs = logs.filter((log): log is ChainEventLog => {
    return typeof log.blockNumber === "bigint" && typeof log.transactionHash === "string" && log.transactionHash.startsWith("0x");
  });

  const timestamps = await blockTimestamps(
    client,
    chainLogs.map((log) => log.blockNumber)
  );

  const events = chainLogs
    .map((log) => {
      const args = (log as any).args as Record<string, unknown>;
      const name = (log as any).eventName as string;
      const borrower = normalizeAddress(args.borrower);
      const owner = normalizeAddress(args.owner);
      const lender = normalizeAddress(args.lender);
      const scoreAccount = normalizeAddress(args.account);
      const eventAccount = borrower || owner || lender || scoreAccount;
      const poolId = args.poolId === undefined ? undefined : Number(args.poolId);
      const loanId = args.loanId === undefined ? undefined : Number(args.loanId);
      const score = args.score === undefined ? undefined : Number(args.score);
      const snapshotNumber = args.snapshotNumber === undefined ? undefined : Number(args.snapshotNumber);
      const amount = (args.principal ?? args.amount ?? args.supplied ?? args.recoveredCollateral) as bigint | undefined;

      return {
        type: eventType(name),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        timestamp: timestamps.get(log.blockNumber.toString()) || 0,
        account: eventAccount,
        poolId,
        loanId,
        score,
        snapshotNumber,
        amount,
        label: eventLabel(name, args),
      } satisfies IndexedProtocolEvent;
    })
    .sort((a, b) => b.timestamp - a.timestamp || Number(b.blockNumber - a.blockNumber));

  const scoreHistory = events
    .filter((event) => event.type === "score" && event.score !== undefined && (!account || sameAddress(event.account, account)))
    .map((event, index) => ({
      score: event.score || 0,
      publishedAt: event.timestamp,
      snapshotNumber: event.snapshotNumber || index + 1,
      activityAdjustment: 0,
      refresh: false,
    }))
    .reverse();

  const poolTimeline = events.filter((event) => event.poolId);
  const accountEvents = account ? events.filter((event) => sameAddress(event.account, account)) : events;
  const repaymentEvents = accountEvents.filter((event) => event.type === "repay");
  const defaultEvents = accountEvents.filter((event) => event.type === "default");
  const utilizationHistory = Array.from({ length: poolCount }, (_, index) => {
    const poolId = index + 1;
    const poolEvents = poolTimeline.filter((event) => event.poolId === poolId);
    const borrowCount = poolEvents.filter((event) => event.type === "borrow").length;
    const repayCount = poolEvents.filter((event) => event.type === "repay").length;
    const defaultCount = poolEvents.filter((event) => event.type === "default").length;
    const utilizationBps = Math.min(10_000, Math.max(0, (borrowCount - repayCount - defaultCount) * 2500));
    const defaultRateBps = borrowCount > 0 ? Math.round((defaultCount * 10_000) / borrowCount) : 0;

    return {
      poolId,
      utilizationBps,
      defaultRateBps,
      expectedYieldBps: Math.round((utilizationBps * (10_000 - defaultRateBps)) / 10_000),
      timestamp: poolEvents[0]?.timestamp || Math.floor(Date.now() / 1000),
    };
  });

  return { events, scoreHistory, poolTimeline, repaymentEvents, defaultEvents, utilizationHistory };
}

export function classifyLoanCohorts(loans: Loan[]) {
  const total = loans.length;
  const repaid = loans.filter((loan) => loan.status === 1).length;
  const defaulted = loans.filter((loan) => loan.status === 2).length;
  const active = loans.filter((loan) => loan.status === 0).length;

  return [
    { label: "Active", count: active, bps: total ? Math.round((active * 10_000) / total) : 0 },
    { label: "Repaid", count: repaid, bps: total ? Math.round((repaid * 10_000) / total) : 0 },
    { label: "Defaulted", count: defaulted, bps: total ? Math.round((defaulted * 10_000) / total) : 0 },
  ];
}
