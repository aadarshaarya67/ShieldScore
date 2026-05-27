"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Check,
  CircleAlert,
  Coins,
  ExternalLink,
  FileCheck,
  Gauge,
  History,
  KeyRound,
  Landmark,
  Link2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { arbitrumSepolia, hardhat, sepolia } from "viem/chains";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RPC_URL,
  erc20Abi,
  NATIVE_ASSET,
  SHIELDSCORE_ADDRESS,
  SHIELDSCORE_CHAIN_ID,
  SHIELDSCORE_USDC_ADDRESS,
  shieldScoreAbi,
  type CreditProfile,
  type LendingPool,
  type Loan,
  type ScoreAttestation,
  type ScoreHistoryEntry,
} from "@/lib/shieldscore-contract";
import { demoAttestations, demoLoans, demoPools, demoProfile } from "@/lib/shieldscore-demo";
import type { CreditAuthorization, EncryptedInputLike } from "@/lib/credit-authorization";
import { ingestWalletCreditSignals, type CreditSignalTrend } from "@/lib/credit-ingestion";
import {
  classifyLoanCohorts,
  indexShieldScoreEvents,
  type IndexedProtocolData,
} from "@/lib/shieldscore-indexer";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export type ShieldScorePage = "dashboard" | "score" | "marketplace" | "create" | "repayments" | "attestations" | "risk";
type Bytes32 = `0x${string}`;

type TxRecord = {
  hash: `0x${string}`;
  label: string;
  status: "pending" | "confirmed" | "failed";
  explorerUrl: string;
  timestamp: number;
};

type DeploymentHealth = {
  status?: "ok" | "attention" | "degraded";
  detail?: string;
};

type SnapshotInputs = {
  balanceConsistency: number;
  repaymentHistory: number;
  walletAge: number;
  protocolDiversity: number;
  incomeConsistency: number;
};

type AuthorizedCreditSnapshot = {
  inputs: EncryptedInputLike[];
  authorization: CreditAuthorization;
  signals?: SnapshotInputs;
  trends?: CreditSignalTrend[];
};

const tabs: { id: ShieldScorePage; label: string; href: string; icon: typeof Activity }[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: Activity },
  { id: "score", label: "Score", href: "/score", icon: Lock },
  { id: "marketplace", label: "Marketplace", href: "/marketplace", icon: Landmark },
  { id: "create", label: "Create Pool", href: "/create-pool", icon: Coins },
  { id: "repayments", label: "Repayments", href: "/repayments", icon: Check },
  { id: "attestations", label: "Attest", href: "/attestations", icon: FileCheck },
  { id: "risk", label: "Risk", href: "/risk", icon: ShieldCheck },
];

const factors: { key: keyof SnapshotInputs; label: string; weight: string }[] = [
  { key: "balanceConsistency", label: "Balance consistency", weight: "25%" },
  { key: "repaymentHistory", label: "Repayment history", weight: "30%" },
  { key: "walletAge", label: "Wallet age", weight: "15%" },
  { key: "protocolDiversity", label: "Protocol diversity", weight: "15%" },
  { key: "incomeConsistency", label: "Income consistency", weight: "15%" },
];

const defaultSnapshot: SnapshotInputs = {
  balanceConsistency: 80,
  repaymentHistory: 90,
  walletAge: 70,
  protocolDiversity: 80,
  incomeConsistency: 75,
};

const emptyProfile: CreditProfile = {
  publicScore: 0,
  encryptedUpdatedAt: 0,
  scorePublishedAt: 0,
  creditActivityUpdatedAt: 0,
  snapshotsSubmitted: 0,
  loansRepaid: 0,
  loansRepaidLate: 0,
  loansDefaulted: 0,
  lastRefreshAdjustment: 0,
  totalBorrowed: 0n,
  totalRepaid: 0n,
};

const demoScoreHistory: ScoreHistoryEntry[] = [
  { score: 704, publishedAt: Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60, snapshotNumber: 1, activityAdjustment: 0, refresh: false },
  { score: 728, publishedAt: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60, snapshotNumber: 2, activityAdjustment: 8, refresh: true },
  { score: demoProfile.publicScore, publishedAt: demoProfile.scorePublishedAt, snapshotNumber: 3, activityAdjustment: 16, refresh: true },
];

const emptyIndex: IndexedProtocolData = {
  events: [],
  scoreHistory: [],
  poolTimeline: [],
  repaymentEvents: [],
  defaultEvents: [],
  utilizationHistory: [],
};

const viemChains = {
  421614: arbitrumSepolia,
  11155111: sepolia,
  31337: hardhat,
};

function getViemChain(chainId: number) {
  return viemChains[chainId as keyof typeof viemChains] || arbitrumSepolia;
}

function chainIdHex(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

function walletChainParams(chainId: number) {
  if (chainId === 11155111) {
    return {
      chainId: chainIdHex(chainId),
      chainName: "Sepolia",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [DEFAULT_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    };
  }

  if (chainId === 421614) {
    return {
      chainId: chainIdHex(chainId),
      chainName: "Arbitrum Sepolia",
      nativeCurrency: { name: "Arbitrum Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [DEFAULT_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"],
      blockExplorerUrls: ["https://sepolia.arbiscan.io"],
    };
  }

  return {
    chainId: chainIdHex(chainId),
    chainName: getViemChain(chainId).name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [DEFAULT_RPC_URL],
    blockExplorerUrls: [],
  };
}

async function switchWalletToProtocolChain(provider: EthereumProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(SHIELDSCORE_CHAIN_ID) }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [walletChainParams(SHIELDSCORE_CHAIN_ID)],
    });
  }
}

function shorten(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function asPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function explorerBaseUrl(chainId: number) {
  if (chainId === 11155111) return "https://sepolia.etherscan.io";
  if (chainId === 421614) return "https://sepolia.arbiscan.io";
  return "";
}

function explorerTxUrl(chainId: number, hash: string) {
  const base = explorerBaseUrl(chainId);
  return base ? `${base}/tx/${hash}` : "";
}

function safeParseEther(value: string) {
  try {
    return parseEther(value && Number(value) > 0 ? value : "0");
  } catch {
    return 0n;
  }
}

function safeParseUnits(value: string, decimals: number) {
  try {
    return parseUnits(value && Number(value) > 0 ? value : "0", decimals);
  } catch {
    return 0n;
  }
}

function formatEth(value: bigint, digits = 4) {
  const formatted = Number(formatEther(value));
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
}

function isNativePool(pool?: Pick<LendingPool, "asset">) {
  return !pool || pool.asset.toLowerCase() === NATIVE_ASSET;
}

function assetSymbol(pool?: Pick<LendingPool, "asset">) {
  if (isNativePool(pool)) return "ETH";
  if (SHIELDSCORE_USDC_ADDRESS && pool?.asset.toLowerCase() === SHIELDSCORE_USDC_ADDRESS.toLowerCase()) return "ssUSDC";
  return "ERC20";
}

function formatAssetAmount(pool: Pick<LendingPool, "asset" | "assetDecimals"> | undefined, value: bigint, digits = 4) {
  if (!pool || isNativePool(pool)) return formatEth(value, digits);
  const formatted = Number(formatUnits(value, pool.assetDecimals));
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits: digits })} ${assetSymbol(pool)}`;
}

function parseAssetAmount(pool: Pick<LendingPool, "asset" | "assetDecimals"> | undefined, value: string) {
  return isNativePool(pool) ? safeParseEther(value) : safeParseUnits(value, pool?.assetDecimals || 18);
}

function formatTime(timestamp: number) {
  if (!timestamp) return "n/a";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTransactionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Transaction failed");
  const map: [string, string][] = [
    ["InvalidScore", "Score or threshold is outside the 300-850 range."],
    ["InvalidPoolTerms", "Pool terms failed protocol bounds. Check score, duration, liquidity, and max loan."],
    ["InvalidAsset", "This action is for a different asset type."],
    ["PoolNotActive", "That pool is paused or unavailable."],
    ["NotPoolLender", "Only the pool lender can perform this action."],
    ["InsufficientLiquidity", "The pool does not have enough available liquidity."],
    ["ScoreNotPublished", "Publish a verified score before borrowing."],
    ["ScoreStale", "Refresh your encrypted score before borrowing again."],
    ["ScoreTooLow", "Your published score is below this pool threshold."],
    ["InvalidCreditAuthorization", "The encrypted credit snapshot was not authorized by the attester."],
    ["CreditAuthorizationExpired", "The credit authorization expired. Generate the score again."],
    ["CollateralTooLow", "The supplied collateral is below the pool requirement."],
    ["RepaymentTooLow", "Repayment must cover principal plus interest."],
    ["AttestationUnavailable", "The attestation is unavailable, revoked, or below threshold."],
    ["EnforcedPause", "The guardian pause is active."],
    ["User rejected", "The wallet rejected the transaction."],
  ];
  return map.find(([needle]) => message.includes(needle))?.[1] || message.slice(0, 180);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 8000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("RPC read timed out")), timeoutMs);
    }),
  ]);
}

function scoreFromSnapshot(snapshot: SnapshotInputs) {
  const weighted =
    snapshot.balanceConsistency * 25 +
    snapshot.repaymentHistory * 30 +
    snapshot.walletAge * 15 +
    snapshot.protocolDiversity * 15 +
    snapshot.incomeConsistency * 15;
  return Math.floor(300 + (weighted * 550) / 10_000);
}

function collateralBpsForScore(score: number) {
  if (score >= 800) return 500;
  if (score >= 700) return 2500;
  if (score >= 600) return 5000;
  if (score >= 500) return 10000;
  return 15000;
}

function profileFromTuple(tuple: readonly unknown[]): CreditProfile {
  return {
    publicScore: Number(tuple[0]),
    encryptedUpdatedAt: Number(tuple[1]),
    scorePublishedAt: Number(tuple[2]),
    creditActivityUpdatedAt: Number(tuple[3]),
    snapshotsSubmitted: Number(tuple[4]),
    loansRepaid: Number(tuple[5]),
    loansRepaidLate: Number(tuple[6]),
    loansDefaulted: Number(tuple[7]),
    lastRefreshAdjustment: Number(tuple[8]),
    totalBorrowed: tuple[9] as bigint,
    totalRepaid: tuple[10] as bigint,
  };
}

function scoreHistoryFromTuple(tuple: readonly unknown[]): ScoreHistoryEntry {
  return {
    score: Number(tuple[0]),
    publishedAt: Number(tuple[1]),
    snapshotNumber: Number(tuple[2]),
    activityAdjustment: Number(tuple[3]),
    refresh: Boolean(tuple[4]),
  };
}

function poolFromTuple(id: number, tuple: readonly unknown[], analytics: readonly unknown[]): LendingPool {
  return {
    id,
    lender: tuple[0] as Address,
    asset: tuple[1] as Address,
    assetDecimals: Number(tuple[2]),
    minScore: Number(tuple[3]),
    baseCollateralBps: Number(tuple[4]),
    interestBps: Number(tuple[5]),
    durationSeconds: Number(tuple[6]),
    collateralPriceWei: tuple[7] as bigint,
    maxLoanAmount: tuple[8] as bigint,
    liquidity: tuple[9] as bigint,
    totalSupplied: tuple[10] as bigint,
    totalBorrowed: tuple[11] as bigint,
    totalRepaid: tuple[12] as bigint,
    interestEarned: tuple[13] as bigint,
    defaultedPrincipal: tuple[14] as bigint,
    recoveredCollateral: tuple[15] as bigint,
    borrowerScoreTotal: tuple[16] as bigint,
    loanCount: Number(tuple[17]),
    defaultCount: Number(tuple[18]),
    active: Boolean(tuple[19]),
    utilizationBps: Number(analytics[0]),
    averageScore: Number(analytics[1]),
    defaultRateBps: Number(analytics[2]),
    expectedYieldBps: Number(analytics[3]),
    activePrincipal: analytics[4] as bigint,
  };
}

function loanFromTuple(id: number, tuple: readonly unknown[]): Loan {
  return {
    id,
    poolId: Number(tuple[0]),
    borrower: tuple[1] as Address,
    principal: tuple[2] as bigint,
    collateral: tuple[3] as bigint,
    interest: tuple[4] as bigint,
    startTime: Number(tuple[5]),
    dueTime: Number(tuple[6]),
    status: Number(tuple[7]),
  };
}

function attestationFromTuple(id: Bytes32, tuple: readonly unknown[]): ScoreAttestation {
  return {
    id,
    owner: tuple[0] as Address,
    threshold: Number(tuple[1]),
    scoreAtIssue: Number(tuple[2]),
    issuedAt: Number(tuple[3]),
    revoked: Boolean(tuple[4]),
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">
      <span className="h-px w-6 bg-foreground/25" />
      {children}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  ariaLabel,
  title,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  variant?: "solid" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
        variant === "solid"
          ? "bg-foreground text-background shadow-sm hover:bg-foreground/90"
          : "border border-foreground/15 bg-background/70 text-foreground hover:border-foreground/35 hover:bg-foreground/[0.04]"
      )}
    >
      {children}
    </button>
  );
}

function ActionLink({
  children,
  href,
  variant = "solid",
}: {
  children: React.ReactNode;
  href: string;
  variant?: "solid" | "outline";
}) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-all",
        variant === "solid"
          ? "bg-foreground text-background shadow-sm hover:bg-foreground/90"
          : "border border-foreground/15 bg-background/70 text-foreground hover:border-foreground/35 hover:bg-foreground/[0.04]"
      )}
    >
      {children}
    </a>
  );
}

function TextInput({
  label,
  value,
  onChange,
  suffix,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="flex h-11 items-center rounded-md border border-foreground/10 bg-background/85 px-3 focus-within:border-foreground/35 focus-within:bg-background">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="w-full bg-transparent text-sm outline-none disabled:text-muted-foreground"
          inputMode="decimal"
        />
        {suffix && <span className="ml-3 text-xs font-mono text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

function DashboardBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.08em]",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700",
        tone === "neutral" && "border-foreground/10 bg-foreground/[0.03] text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function DashboardMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-background/80 p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-4 font-display text-3xl leading-none sm:text-4xl">{value}</div>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function DashboardProgress({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{clamped}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-foreground/10 bg-background/[0.82] shadow-[0_18px_60px_rgba(0,0,0,0.04)]", className)}>{children}</div>;
}

function PageHeader({
  label,
  title,
  detail,
  actions,
}: {
  label: string;
  title: string;
  detail?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <SectionLabel>{label}</SectionLabel>
        <h1 className="mt-4 max-w-4xl text-balance font-display text-4xl leading-none sm:text-5xl lg:text-6xl">{title}</h1>
        {detail && <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">{detail}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-end gap-3">{actions}</div>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-foreground/10 bg-background/85 px-3 text-sm outline-none transition-colors focus:border-foreground/35"
      >
        {children}
      </select>
    </label>
  );
}

function StatusRailItem({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full bg-foreground/35",
          tone === "success" && "bg-emerald-600",
          tone === "warning" && "bg-amber-600"
        )}
      />
      <span className="text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

export function ShieldScoreApp({ initialTab = "dashboard" }: { initialTab?: ShieldScorePage }) {
  const hasContract = Boolean(SHIELDSCORE_ADDRESS);
  const activeTab = initialTab;
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>(SHIELDSCORE_CHAIN_ID);
  const [publicClient, setPublicClient] = useState<PublicClient>();
  const [walletClient, setWalletClient] = useState<WalletClient>();
  const [cofheClient, setCofheClient] = useState<any>();
  const [profile, setProfile] = useState<CreditProfile>(hasContract ? emptyProfile : demoProfile);
  const [pools, setPools] = useState<LendingPool[]>(hasContract ? [] : demoPools);
  const [loans, setLoans] = useState<Loan[]>(hasContract ? [] : demoLoans);
  const [attestations, setAttestations] = useState<ScoreAttestation[]>(hasContract ? [] : demoAttestations);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryEntry[]>(hasContract ? [] : demoScoreHistory);
  const [indexedData, setIndexedData] = useState<IndexedProtocolData>(emptyIndex);
  const [signalTrends, setSignalTrends] = useState<CreditSignalTrend[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotInputs>(defaultSnapshot);
  const [poolForm, setPoolForm] = useState({
    assetType: "native",
    tokenAddress: SHIELDSCORE_USDC_ADDRESS || "",
    collateralPrice: "0.0005",
    minScore: "650",
    collateral: "40",
    interest: "12",
    duration: "30",
    maxLoan: "0.01",
    liquidity: "0.03",
  });
  const [borrowForm, setBorrowForm] = useState({ poolId: "1", amount: "0.005" });
  const [fundForm, setFundForm] = useState({ poolId: "1", amount: "1" });
  const [withdrawForm, setWithdrawForm] = useState({ poolId: "1", amount: "0.25" });
  const [attestationThreshold, setAttestationThreshold] = useState("700");
  const [verifyForm, setVerifyForm] = useState({ id: "", owner: "", threshold: "700" });
  const [verifyResult, setVerifyResult] = useState<string>();
  const [selectedLoanId, setSelectedLoanId] = useState("1");
  const [busy, setBusy] = useState(false);
  const [lastGasEstimate, setLastGasEstimate] = useState<bigint>();
  const [txHistory, setTxHistory] = useState<TxRecord[]>([]);
  const [status, setStatus] = useState(hasContract ? "Ready for wallet connection" : "Demo mode: set NEXT_PUBLIC_SHIELDSCORE_ADDRESS for live chain writes");
  const [deploymentHealth, setDeploymentHealth] = useState<DeploymentHealth>();
  const [activityLog, setActivityLog] = useState<string[]>([
    hasContract ? "Protocol console loaded" : "Loaded sample protocol state",
  ]);

  const readOnlyClient = useMemo(
    () =>
      createPublicClient({
        chain: getViemChain(SHIELDSCORE_CHAIN_ID),
        transport: http(DEFAULT_RPC_URL),
      }),
    []
  );

  const selectedPool = pools.find((pool) => String(pool.id) === borrowForm.poolId) || pools[0];
  const selectedFundPool = pools.find((pool) => String(pool.id) === fundForm.poolId) || pools[0];
  const selectedWithdrawPool = pools.find((pool) => String(pool.id) === withdrawForm.poolId) || pools[0];
  const activeLoans = loans.filter((loan) => loan.status === 0);
  const selectedLoan = activeLoans.find((loan) => String(loan.id) === selectedLoanId) || activeLoans[0];
  const selectedLoanPool = selectedLoan ? pools.find((pool) => pool.id === selectedLoan.poolId) : undefined;
  const projectedScore = scoreFromSnapshot(snapshot);
  const effectiveScore = profile.publicScore || (!hasContract ? projectedScore : 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const scoreStale =
    hasContract &&
    profile.publicScore > 0 &&
    (profile.creditActivityUpdatedAt > profile.scorePublishedAt || nowSeconds > profile.scorePublishedAt + 30 * 24 * 60 * 60);
  const scoreTier = effectiveScore >= 800 ? "Prime" : effectiveScore >= 700 ? "Strong" : effectiveScore >= 600 ? "Qualified" : effectiveScore >= 500 ? "Watchlist" : "No score";
  const borrowPrincipal = parseAssetAmount(selectedPool, borrowForm.amount);
  const borrowCollateralBps = selectedPool
    ? Math.min(selectedPool.baseCollateralBps, collateralBpsForScore(effectiveScore))
    : 0;
  const requiredCollateral = selectedPool
    ? isNativePool(selectedPool)
      ? (borrowPrincipal * BigInt(borrowCollateralBps)) / 10_000n
      : (borrowPrincipal * selectedPool.collateralPriceWei * BigInt(borrowCollateralBps)) /
        (10_000n * 10n ** BigInt(selectedPool.assetDecimals))
    : 0n;
  const displayedScoreHistory = scoreHistory.length ? scoreHistory : indexedData.scoreHistory;
  const latestScoreEntry = displayedScoreHistory.length ? displayedScoreHistory[displayedScoreHistory.length - 1] : undefined;
  const scoreProgress = Math.round(Math.max(0, Math.min(100, ((effectiveScore - 300) / 550) * 100)));
  const repaymentTotal = profile.loansRepaid + profile.loansRepaidLate + profile.loansDefaulted;
  const repaymentRate = repaymentTotal ? Math.round((profile.loansRepaid / repaymentTotal) * 100) : 0;
  const activePoolCount = pools.filter((pool) => pool.active).length;
  const qualifiedPools = pools.filter((pool) => pool.active && effectiveScore >= pool.minScore);
  const deploymentIssue = deploymentHealth?.status && deploymentHealth.status !== "ok" ? deploymentHealth.detail : undefined;
  const dashboardStatusTone = deploymentIssue || busy || scoreStale ? "warning" : effectiveScore ? "success" : "neutral";
  const dashboardStatusLabel = deploymentIssue ? "Health check" : busy ? "Pending" : scoreStale ? "Needs refresh" : effectiveScore ? "Live score" : "Setup needed";
  const dashboardAction = useMemo(() => {
    if (!account) {
      return {
        href: undefined,
        label: "Connect wallet",
        detail: "Connect a wallet to load your on-chain score, loans, attestations, and pool eligibility.",
        icon: Wallet,
      };
    }

    if (profile.snapshotsSubmitted === 0) {
      return {
        href: "/score",
        label: "Generate score",
        detail: "Publish your first encrypted score before borrowing or issuing attestations.",
        icon: KeyRound,
      };
    }

    if (scoreStale) {
      return {
        href: "/score",
        label: "Refresh score",
        detail: "Your credit activity changed after the last publication. Refresh before the next borrow.",
        icon: RefreshCw,
      };
    }

    if (activeLoans.length > 0) {
      return {
        href: "/repayments",
        label: "Review repayments",
        detail: `${activeLoans.length} active loan${activeLoans.length === 1 ? "" : "s"} need repayment tracking.`,
        icon: Check,
      };
    }

    if (qualifiedPools.length > 0) {
      return {
        href: "/marketplace",
        label: "Borrow from marketplace",
        detail: `${qualifiedPools.length} active pool${qualifiedPools.length === 1 ? "" : "s"} currently match your score.`,
        icon: Landmark,
      };
    }

    return {
      href: "/marketplace",
      label: "Browse pools",
      detail: "No live pool matches your score yet. Review thresholds and liquidity before borrowing.",
      icon: Search,
    };
  }, [account, activeLoans.length, profile.snapshotsSubmitted, qualifiedPools.length, scoreStale]);
  const DashboardActionIcon = dashboardAction.icon;
  const loanCohorts = classifyLoanCohorts(loans);
  const isPoolLender = useCallback(
    (pool?: LendingPool) => Boolean(!hasContract || (account && pool && account.toLowerCase() === pool.lender.toLowerCase())),
    [account, hasContract]
  );

  const addLog = useCallback((message: string) => {
    setActivityLog((current) => [message, ...current].slice(0, 6));
  }, []);

  const refreshData = useCallback(
    async (clientOverride?: PublicClient, accountOverride?: Address) => {
      if (!hasContract || !SHIELDSCORE_ADDRESS) return;
      const contractAddress = SHIELDSCORE_ADDRESS as Address;
      const client = clientOverride || publicClient || readOnlyClient;
      const owner = accountOverride || account;
      setStatus("Refreshing on-chain state");

      try {
        const poolTotal = Number(
          await withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "poolCount" } as any))
        );
        const nextPools = await Promise.all(
          Array.from({ length: poolTotal }, async (_, index) => {
            const id = index + 1;
            const [poolTuple, analyticsTuple] = await Promise.all([
              withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "pools", args: [BigInt(id)] } as any)),
              withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "poolAnalytics", args: [BigInt(id)] } as any)),
            ]);
            return poolFromTuple(id, poolTuple as readonly unknown[], analyticsTuple as readonly unknown[]);
          })
        );
        setPools(nextPools);

        const nextIndex = await indexShieldScoreEvents({ client, address: contractAddress, account: owner, poolCount: poolTotal }).catch(
          () => emptyIndex
        );
        setIndexedData(nextIndex);

        if (owner) {
          const [profileTuple, loanIds, attestationIds, historyTuple] = await Promise.all([
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "profiles", args: [owner] } as any)),
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "borrowerLoanIds", args: [owner] } as any)),
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "ownerAttestationIds", args: [owner] } as any)),
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "scoreHistoryOf", args: [owner] } as any)),
          ]);
          const nextProfile = profileFromTuple(profileTuple as readonly unknown[]);
          setProfile(nextProfile);
          const nextHistory = (historyTuple as readonly unknown[]).map((item) => scoreHistoryFromTuple(item as readonly unknown[]));
          setScoreHistory(nextHistory);

          const nextLoans = await Promise.all(
            (loanIds as bigint[]).map(async (id) => {
              const tuple = await withTimeout(client.readContract({
                address: contractAddress,
                abi: shieldScoreAbi,
                functionName: "loans",
                args: [id],
              } as any));
              return loanFromTuple(Number(id), tuple as readonly unknown[]);
            })
          );
          setLoans(nextLoans);

          const nextAttestations = await Promise.all(
            (attestationIds as Bytes32[]).map(async (id) => {
              const tuple = await withTimeout(client.readContract({
                address: contractAddress,
                abi: shieldScoreAbi,
                functionName: "attestations",
                args: [id],
              } as any));
              return attestationFromTuple(id, tuple as readonly unknown[]);
            })
          );
          setAttestations(nextAttestations);

          const imported = await ingestWalletCreditSignals({
            client,
            account: owner,
            profile: nextProfile,
            loans: nextLoans,
            pools: nextPools,
            index: nextIndex,
          }).catch(() => undefined);
          if (imported) {
            setSignalTrends(imported.trends);
          }
        } else {
          setProfile(emptyProfile);
          setLoans([]);
          setAttestations([]);
          setScoreHistory([]);
          setSignalTrends([]);
        }

        setStatus("On-chain state synced");
      } catch {
        setStatus("Unable to read configured contract");
        if (!owner) {
          setProfile(emptyProfile);
          setLoans([]);
          setAttestations([]);
          setScoreHistory([]);
        }
      }
    },
    [account, hasContract, publicClient, readOnlyClient]
  );

  useEffect(() => {
    refreshData().catch(() => setStatus("Unable to read configured contract"));
  }, [refreshData]);

  useEffect(() => {
    if (!hasContract) {
      setDeploymentHealth(undefined);
      return;
    }

    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        const checks = Array.isArray(payload?.checks) ? payload.checks : [];
        const primaryIssue =
          checks.find((check: { name?: string; status?: string }) => check.name === "wave5-abi" && check.status === "fail") ||
          checks.find((check: { name?: string; status?: string }) => check.status === "fail") ||
          checks.find((check: { name?: string; status?: string }) => check.status === "warn");
        const nextStatus = payload?.status === "ok" ? "ok" : response.ok ? "attention" : "degraded";
        setDeploymentHealth({
          status: nextStatus,
          detail:
            nextStatus === "ok"
              ? undefined
              : primaryIssue?.detail || "Production health check needs attention before all on-chain features are live.",
        });
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setDeploymentHealth({ status: "attention", detail: "Production health check is not reachable from the dashboard." });
        }
      });

    return () => controller.abort();
  }, [hasContract]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setVerifyForm((current) => ({ ...current, id }));
  }, []);

  useEffect(() => {
    if (account) setVerifyForm((current) => ({ ...current, owner: current.owner || account }));
  }, [account]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccounts = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? (accounts[0] as Address | undefined) : undefined;
      setAccount(next);
      if (next) {
        refreshData(publicClient, next).catch(() => setStatus("Unable to refresh wallet state"));
      } else {
        setProfile(emptyProfile);
        setLoans([]);
        setAttestations([]);
        setScoreHistory([]);
        setSignalTrends([]);
      }
    };
    const handleChain = (nextChain: unknown) => {
      if (typeof nextChain === "string") {
        const next = Number(nextChain);
        setChainId(next);
        if (next !== SHIELDSCORE_CHAIN_ID) setStatus(`Switch to ${getViemChain(SHIELDSCORE_CHAIN_ID).name} to write on-chain`);
      }
    };
    window.ethereum.on?.("accountsChanged", handleAccounts);
    window.ethereum.on?.("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, [publicClient, refreshData]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus("Wallet extension not found");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      let nextChainId = Number((await window.ethereum.request({ method: "eth_chainId" })) as string);
      if (nextChainId !== SHIELDSCORE_CHAIN_ID) {
        setStatus(`Switching wallet to ${getViemChain(SHIELDSCORE_CHAIN_ID).name}`);
        await switchWalletToProtocolChain(window.ethereum);
        nextChainId = Number((await window.ethereum.request({ method: "eth_chainId" })) as string);
      }
      if (nextChainId !== SHIELDSCORE_CHAIN_ID) throw new Error("Wallet is on the wrong network");
      const chain = getViemChain(SHIELDSCORE_CHAIN_ID);
      const nextAccount = accounts[0];
      if (!nextAccount) throw new Error("No wallet account returned");
      const nextPublicClient = createPublicClient({ chain, transport: custom(window.ethereum) });
      const nextWalletClient = createWalletClient({ account: nextAccount, chain, transport: custom(window.ethereum) });

      setAccount(nextAccount);
      setChainId(nextChainId);
      setPublicClient(nextPublicClient);
      setWalletClient(nextWalletClient);

      try {
        const [{ createCofheClient, createCofheConfig }, cofheChains] = await Promise.all([
          import("@cofhe/sdk/web"),
          import("@cofhe/sdk/chains"),
        ]);
        const cofheChain = cofheChains.getChainById(SHIELDSCORE_CHAIN_ID);
        if (!cofheChain) throw new Error("Configured chain is not supported by CoFHE");
        const client = createCofheClient(createCofheConfig({ supportedChains: [cofheChain] }));
        await (client as any).connect(nextPublicClient as any, nextWalletClient as any);
        setCofheClient(client);
      } catch {
        setCofheClient(undefined);
      }

      await refreshData(nextPublicClient, nextAccount);
      setStatus(`Connected ${shorten(nextAccount)}`);
      addLog(`Wallet connected on chain ${SHIELDSCORE_CHAIN_ID}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed");
    } finally {
      setBusy(false);
    }
  };

  const recordTx = useCallback(
    (hash: `0x${string}`, label: string, status: TxRecord["status"]) => {
      setTxHistory((current) => {
        const explorerUrl = explorerTxUrl(SHIELDSCORE_CHAIN_ID, hash);
        const existing = current.find((tx) => tx.hash === hash);
        if (existing) {
          return current.map((tx) => (tx.hash === hash ? { ...tx, status } : tx));
        }
        return [{ hash, label, status, explorerUrl, timestamp: Math.floor(Date.now() / 1000) }, ...current].slice(0, 8);
      });
    },
    []
  );

  const ensureNativeGasBalance = async (value: bigint, gas: bigint) => {
    if (!publicClient || !account) return;
    const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: account }), publicClient.getGasPrice()]);
    if (balance < value + gas * gasPrice) {
      throw new Error("Wallet balance is too low for value plus estimated gas");
    }
  };

  const writeContract = async (functionName: string, args: unknown[], value?: bigint, label = "Transaction") => {
    if (!hasContract || !SHIELDSCORE_ADDRESS || !walletClient || !publicClient || !account) {
      throw new Error("Wallet or contract not ready");
    }
    if (chainId !== SHIELDSCORE_CHAIN_ID && window.ethereum) {
      setStatus(`Switching wallet to ${getViemChain(SHIELDSCORE_CHAIN_ID).name}`);
      await switchWalletToProtocolChain(window.ethereum);
      setChainId(SHIELDSCORE_CHAIN_ID);
    }
    const request = {
      address: SHIELDSCORE_ADDRESS,
      abi: shieldScoreAbi,
      functionName,
      args,
      account,
      chain: getViemChain(SHIELDSCORE_CHAIN_ID),
      value,
    } as any;
    const gas = await publicClient.estimateContractGas(request);
    setLastGasEstimate(gas);
    await ensureNativeGasBalance(value || 0n, gas);
    const hash = await walletClient.writeContract({
      ...request,
      gas,
    });
    recordTx(hash, label, "pending");
    toast.loading(`${label} pending`, { id: hash, description: shorten(hash) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const confirmed = receipt.status === "success";
    recordTx(hash, label, confirmed ? "confirmed" : "failed");
    if (confirmed) {
      toast.success(`${label} confirmed`, { id: hash, description: shorten(hash) });
    } else {
      toast.error(`${label} failed`, { id: hash, description: shorten(hash) });
      throw new Error(`${label} failed on-chain`);
    }
    return hash;
  };

  const writeErc20 = async (token: Address, functionName: string, args: unknown[], label: string) => {
    if (!walletClient || !publicClient || !account) throw new Error("Wallet not ready");
    const request = {
      address: token,
      abi: erc20Abi,
      functionName,
      args,
      account,
      chain: getViemChain(SHIELDSCORE_CHAIN_ID),
    } as any;
    const gas = await publicClient.estimateContractGas(request);
    setLastGasEstimate(gas);
    await ensureNativeGasBalance(0n, gas);
    const hash = await walletClient.writeContract({ ...request, gas });
    recordTx(hash, label, "pending");
    toast.loading(`${label} pending`, { id: hash, description: shorten(hash) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const confirmed = receipt.status === "success";
    recordTx(hash, label, confirmed ? "confirmed" : "failed");
    if (confirmed) {
      toast.success(`${label} confirmed`, { id: hash, description: shorten(hash) });
    } else {
      toast.error(`${label} failed`, { id: hash, description: shorten(hash) });
      throw new Error(`${label} failed on-chain`);
    }
    return hash;
  };

  const approveIfNeeded = async (token: Address, amount: bigint, label: string) => {
    if (!account || !SHIELDSCORE_ADDRESS || !publicClient) throw new Error("Wallet or contract not ready");
    const allowance = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, SHIELDSCORE_ADDRESS],
    } as any)) as bigint;
    if (allowance >= amount) return;
    await writeErc20(token, "approve", [SHIELDSCORE_ADDRESS, amount], label);
  };

  const requestAuthorizedCreditSnapshot = async (refresh: boolean): Promise<AuthorizedCreditSnapshot> => {
    if (!account) throw new Error("Connect a wallet before generating a score");
    const response = await fetch("/api/credit-authorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account,
        refresh,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      authorization?: { nonce: string; deadline: number; signature: Bytes32 };
      inputs?: { ctHash: string; securityZone: number; utype: number; signature: Bytes32 }[];
      signals?: SnapshotInputs;
      trends?: CreditSignalTrend[];
      error?: string;
    };
    if (!response.ok || !body.authorization || !body.inputs || body.inputs.length !== 5) {
      throw new Error(body.error || "Unable to authorize encrypted credit snapshot");
    }
    return {
      inputs: body.inputs.map((input) => ({
        ctHash: BigInt(input.ctHash),
        securityZone: input.securityZone,
        utype: input.utype,
        signature: input.signature,
      })),
      authorization: {
        nonce: BigInt(body.authorization.nonce),
        deadline: body.authorization.deadline,
        signature: body.authorization.signature,
      },
      signals: body.signals,
      trends: body.trends,
    };
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await action();
      addLog(label);
      await refreshData();
    } catch (error) {
      const message = formatTransactionError(error);
      setStatus(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const generateScore = async (refresh = false) => {
    await runAction(refresh ? "Encrypted score refreshed from wallet activity" : "Encrypted score generated and published", async () => {
      if (!hasContract) {
        setProfile((current) => ({
          ...current,
          publicScore: projectedScore,
          encryptedUpdatedAt: Math.floor(Date.now() / 1000),
          scorePublishedAt: Math.floor(Date.now() / 1000),
          snapshotsSubmitted: current.snapshotsSubmitted + 1,
        }));
        return;
      }
      if (!cofheClient) throw new Error("Connect wallet with CoFHE enabled first");
      setStatus("Requesting trusted wallet-signal encryption");
      const { inputs: encrypted, authorization, signals, trends } = await requestAuthorizedCreditSnapshot(refresh);
      if (signals) setSnapshot(signals);
      if (trends) setSignalTrends(trends);
      await writeContract(
        refresh ? "submitEncryptedRefreshSnapshot" : "submitEncryptedSnapshot",
        [...encrypted, authorization],
        undefined,
        refresh ? "Submit refresh snapshot" : "Submit encrypted snapshot"
      );
      const handle = await publicClient!.readContract({
        address: SHIELDSCORE_ADDRESS!,
        abi: shieldScoreAbi,
        functionName: "encryptedScoreOf",
        args: [account!],
      } as any);
      setStatus("Requesting CoFHE decrypt-for-transaction signature");
      const decrypted = await cofheClient.decryptForTx(handle).withoutPermit().execute();
      await writeContract("publishScore", [Number(decrypted.decryptedValue), decrypted.signature], undefined, "Publish verified score");
    });
  };

  const importWalletData = async () => {
    await runAction("Wallet credit data imported", async () => {
      const client = publicClient || readOnlyClient;
      const owner = account;
      if (!owner) throw new Error("Connect a wallet before importing credit data");
      const imported = await ingestWalletCreditSignals({
        client,
        account: owner,
        profile,
        loans,
        pools,
        index: indexedData,
      });
      setSnapshot(imported.signals);
      setSignalTrends(imported.trends);
    });
  };

  const createPool = async () => {
    await runAction("Lending pool created", async () => {
      const minScore = Number(poolForm.minScore);
      const baseCollateralBps = Math.round(Number(poolForm.collateral) * 100);
      const interestBps = Math.round(Number(poolForm.interest) * 100);
      const durationSeconds = Math.round(Number(poolForm.duration) * 24 * 60 * 60);
      const tokenAddress = poolForm.tokenAddress.trim();
      let tokenDecimals = poolForm.assetType === "native" ? 18 : 6;
      if (poolForm.assetType !== "native" && isAddress(tokenAddress) && hasContract && publicClient) {
        tokenDecimals = Number(
          await publicClient
            .readContract({
              address: getAddress(tokenAddress) as Address,
              abi: erc20Abi,
              functionName: "decimals",
            } as any)
            .catch(() => 18)
        );
      }
      if (tokenDecimals < 0 || tokenDecimals > 18) throw new Error("Token decimals must be between 0 and 18");
      const maxLoanAmount =
        poolForm.assetType === "native" ? safeParseEther(poolForm.maxLoan) : safeParseUnits(poolForm.maxLoan, tokenDecimals);
      const liquidity =
        poolForm.assetType === "native" ? safeParseEther(poolForm.liquidity) : safeParseUnits(poolForm.liquidity, tokenDecimals);
      const collateralPriceWei = safeParseEther(poolForm.collateralPrice);
      if (![minScore, baseCollateralBps, interestBps, durationSeconds].every(Number.isFinite)) {
        throw new Error("Pool terms must be valid numbers");
      }
      if (minScore < 300 || minScore > 850) throw new Error("Minimum score must be between 300 and 850");
      if (baseCollateralBps <= 0 || baseCollateralBps > 15_000) throw new Error("Collateral must be above 0% and no more than 150%");
      if (interestBps < 0 || interestBps > 5_000) throw new Error("Interest must be between 0% and 50%");
      if (durationSeconds <= 0) throw new Error("Duration must be at least one day");
      if (maxLoanAmount <= 0n || liquidity <= 0n) throw new Error("Loan and liquidity amounts must be above zero");
      if (maxLoanAmount > liquidity) throw new Error("Max loan cannot exceed initial liquidity");
      if (poolForm.assetType !== "native" && (!isAddress(tokenAddress) || collateralPriceWei <= 0n)) {
        throw new Error("ERC-20 pools need a token address and ETH collateral price");
      }
      if (
        poolForm.assetType !== "native" &&
        SHIELDSCORE_USDC_ADDRESS &&
        tokenAddress.toLowerCase() !== SHIELDSCORE_USDC_ADDRESS.toLowerCase()
      ) {
        throw new Error("Only the approved ssUSDC asset is available from this frontend");
      }
      const newPool: LendingPool = {
        id: pools.length + 1,
        lender: account || "0x8a2d02d41483A492C636BFcC00fE9963F6eBB1e2",
        asset: poolForm.assetType === "native" ? NATIVE_ASSET : (getAddress(tokenAddress) as Address),
        assetDecimals: tokenDecimals,
        minScore,
        baseCollateralBps,
        interestBps,
        durationSeconds,
        collateralPriceWei: poolForm.assetType === "native" ? parseEther("1") : collateralPriceWei,
        maxLoanAmount,
        liquidity,
        totalSupplied: liquidity,
        totalBorrowed: 0n,
        totalRepaid: 0n,
        interestEarned: 0n,
        defaultedPrincipal: 0n,
        recoveredCollateral: 0n,
        borrowerScoreTotal: 0n,
        loanCount: 0,
        defaultCount: 0,
        active: true,
        utilizationBps: 0,
        averageScore: 0,
        defaultRateBps: 0,
        expectedYieldBps: 0,
        activePrincipal: 0n,
      };
      if (!hasContract) {
        setPools((current) => [newPool, ...current]);
        return;
      }
      if (poolForm.assetType === "native") {
        await writeContract(
          "createPool",
          [minScore, baseCollateralBps, interestBps, durationSeconds, maxLoanAmount],
          liquidity,
          "Create native pool"
        );
        return;
      }
      const token = getAddress(tokenAddress) as Address;
      await approveIfNeeded(token, liquidity, "Approve pool liquidity");
      await writeContract(
        "createErc20Pool",
        [token, collateralPriceWei, minScore, baseCollateralBps, interestBps, durationSeconds, maxLoanAmount, liquidity],
        undefined,
        "Create ERC-20 pool"
      );
    });
  };

  const borrow = async () => {
    await runAction("Loan drawn from pool", async () => {
      if (!selectedPool) throw new Error("Select a pool");
      if (!selectedPool.active) throw new Error("Selected pool is paused");
      if (effectiveScore < selectedPool.minScore) throw new Error("Your published score does not meet this pool threshold");
      if (borrowPrincipal <= 0n) throw new Error("Borrow amount must be above zero");
      if (borrowPrincipal > selectedPool.maxLoanAmount) throw new Error("Borrow amount exceeds this pool's max loan");
      if (borrowPrincipal > selectedPool.liquidity) throw new Error("Borrow amount exceeds available liquidity");
      if (!hasContract) {
        const loan: Loan = {
          id: loans.length + 1,
          poolId: selectedPool.id,
          borrower: account || "0xF5ecB62EacBda5C21bA631f5F6E112A05dbB92a9",
          principal: borrowPrincipal,
          collateral: requiredCollateral,
          interest: (borrowPrincipal * BigInt(selectedPool.interestBps) * BigInt(selectedPool.durationSeconds)) / (10_000n * 365n * 24n * 60n * 60n),
          startTime: Math.floor(Date.now() / 1000),
          dueTime: Math.floor(Date.now() / 1000) + selectedPool.durationSeconds,
          status: 0,
        };
        setLoans((current) => [loan, ...current]);
        setPools((current) =>
          current.map((pool) =>
            pool.id === selectedPool.id
              ? {
                  ...pool,
                  liquidity: pool.liquidity - borrowPrincipal,
                  totalBorrowed: pool.totalBorrowed + borrowPrincipal,
                  activePrincipal: pool.activePrincipal + borrowPrincipal,
                  loanCount: pool.loanCount + 1,
                }
              : pool
          )
        );
        return;
      }
      await writeContract("borrow", [BigInt(selectedPool.id), borrowPrincipal], requiredCollateral, "Borrow from pool");
    });
  };

  const repay = async () => {
    await runAction("Loan repaid", async () => {
      if (!selectedLoan) throw new Error("No active loan selected");
      const due = selectedLoan.principal + selectedLoan.interest;
      if (!hasContract) {
        setLoans((current) => current.map((loan) => (loan.id === selectedLoan.id ? { ...loan, status: 1 } : loan)));
        setProfile((current) => ({
          ...current,
          loansRepaid: current.loansRepaid + 1,
          totalRepaid: current.totalRepaid + due,
        }));
        return;
      }
      if (selectedLoanPool && !isNativePool(selectedLoanPool)) {
        await approveIfNeeded(selectedLoanPool.asset, due, "Approve repayment");
        await writeContract("repay", [BigInt(selectedLoan.id)], undefined, "Repay token loan");
        return;
      }
      await writeContract("repay", [BigInt(selectedLoan.id)], due, "Repay native loan");
    });
  };

  const issueAttestation = async () => {
    await runAction("Score attestation issued", async () => {
      const threshold = Number(attestationThreshold);
      if (threshold < 300 || threshold > 850) throw new Error("Threshold must be between 300 and 850");
      if (profile.publicScore < threshold) throw new Error("Published score is below this threshold");
      if (!hasContract) {
        setAttestations((current) => [
          {
            id: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}` as Address,
            owner: account || "0xF5ecB62EacBda5C21bA631f5F6E112A05dbB92a9",
            threshold,
            scoreAtIssue: profile.publicScore,
            issuedAt: Math.floor(Date.now() / 1000),
            revoked: false,
          },
          ...current,
        ]);
        return;
      }
      await writeContract("issueScoreAttestation", [threshold], undefined, "Issue attestation");
    });
  };

  const markDefault = async (loanId: number) => {
    await runAction("Loan marked defaulted", async () => {
      if (!hasContract) {
        setLoans((current) => current.map((loan) => (loan.id === loanId ? { ...loan, status: 2 } : loan)));
        return;
      }
      await writeContract("markDefault", [BigInt(loanId)], undefined, "Mark default");
    });
  };

  const togglePool = async (pool: LendingPool) => {
    await runAction(pool.active ? "Pool paused" : "Pool reactivated", async () => {
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can change pool status");
      if (!hasContract) {
        setPools((current) => current.map((item) => (item.id === pool.id ? { ...item, active: !item.active } : item)));
        return;
      }
      await writeContract("setPoolActive", [BigInt(pool.id), !pool.active], undefined, pool.active ? "Pause pool" : "Reactivate pool");
    });
  };

  const fundPool = async () => {
    await runAction("Pool funded", async () => {
      const poolId = Number(fundForm.poolId);
      const pool = pools.find((item) => item.id === poolId);
      if (!pool) throw new Error("Select a pool to fund");
      const amount = parseAssetAmount(pool, fundForm.amount);
      if (amount <= 0n) throw new Error("Funding amount must be above zero");
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can fund this pool");
      if (!hasContract) {
        setPools((current) =>
          current.map((pool) => (pool.id === poolId ? { ...pool, liquidity: pool.liquidity + amount, totalSupplied: pool.totalSupplied + amount } : pool))
        );
        return;
      }
      if (isNativePool(pool)) {
        await writeContract("fundPool", [BigInt(poolId)], amount, "Fund native pool");
        return;
      }
      await approveIfNeeded(pool.asset, amount, "Approve pool funding");
      await writeContract("fundErc20Pool", [BigInt(poolId), amount], undefined, "Fund ERC-20 pool");
    });
  };

  const withdraw = async () => {
    await runAction("Available liquidity withdrawn", async () => {
      const poolId = Number(withdrawForm.poolId);
      const pool = pools.find((item) => item.id === poolId);
      if (!pool) throw new Error("Select a pool to withdraw from");
      const amount = parseAssetAmount(pool, withdrawForm.amount);
      if (amount <= 0n) throw new Error("Withdrawal amount must be above zero");
      if (amount > pool.liquidity) throw new Error("Withdrawal exceeds available liquidity");
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can withdraw liquidity");
      if (!hasContract) {
        setPools((current) =>
          current.map((pool) => (pool.id === poolId ? { ...pool, liquidity: pool.liquidity > amount ? pool.liquidity - amount : 0n } : pool))
        );
        return;
      }
      await writeContract("withdrawAvailable", [BigInt(poolId), amount], undefined, "Withdraw liquidity");
    });
  };

  const withdrawRecoveredCollateral = async (pool: LendingPool) => {
    await runAction("Recovered collateral withdrawn", async () => {
      if (isNativePool(pool)) throw new Error("Native pool collateral is already credited to liquidity");
      if (pool.recoveredCollateral <= 0n) throw new Error("No recovered collateral available");
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can withdraw recovered collateral");
      if (!hasContract) {
        setPools((current) => current.map((item) => (item.id === pool.id ? { ...item, recoveredCollateral: 0n } : item)));
        return;
      }
      await writeContract(
        "withdrawRecoveredCollateral",
        [BigInt(pool.id), pool.recoveredCollateral],
        undefined,
        "Withdraw recovered collateral"
      );
    });
  };

  const copyAttestation = async (id: string) => {
    const link = `${window.location.origin}/attestations?id=${id}`;
    await navigator.clipboard.writeText(link);
    setStatus("Attestation link copied");
  };

  const revokeAttestation = async (id: string) => {
    await runAction("Score attestation revoked", async () => {
      if (!hasContract) {
        setAttestations((current) => current.map((item) => (item.id === id ? { ...item, revoked: true } : item)));
        return;
      }
      await writeContract("revokeAttestation", [id], undefined, "Revoke attestation");
    });
  };

  const verifyAttestation = async () => {
    await runAction("Attestation verification completed", async () => {
      if (!verifyForm.id || !isAddress(verifyForm.owner)) throw new Error("Enter attestation id and owner address");
      const threshold = Number(verifyForm.threshold);
      if (threshold < 300 || threshold > 850) throw new Error("Threshold must be between 300 and 850");
      if (!hasContract || !SHIELDSCORE_ADDRESS) {
        const match = attestations.find((item) => item.id.toLowerCase() === verifyForm.id.toLowerCase());
        setVerifyResult(match && !match.revoked && match.owner.toLowerCase() === verifyForm.owner.toLowerCase() && match.scoreAtIssue >= threshold ? "Valid" : "Invalid");
        return;
      }
      const result = await readOnlyClient.readContract({
        address: SHIELDSCORE_ADDRESS,
        abi: shieldScoreAbi,
        functionName: "verifyAttestation",
        args: [verifyForm.id as Bytes32, getAddress(verifyForm.owner) as Address, threshold],
      } as any);
      setVerifyResult(result ? "Valid" : "Invalid");
    });
  };

  const faucetUsdc = async () => {
    await runAction("Test USDC requested", async () => {
      if (!SHIELDSCORE_USDC_ADDRESS) throw new Error("No test USDC token is configured");
      await writeErc20(SHIELDSCORE_USDC_ADDRESS, "faucet", [], "Request test USDC");
    });
  };

  return (
    <main className="min-h-screen bg-background text-foreground noise-overlay">
      <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/[0.88] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <a href="/" className="shrink-0 font-display text-2xl leading-none">
            ShieldScore
          </a>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto [scrollbar-width:none] lg:order-none lg:w-auto lg:flex-1 lg:justify-center [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.href}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                )}
              >
                <tab.icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </a>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <span className="hidden max-w-[180px] truncate rounded-md border border-foreground/10 bg-background/70 px-3 py-2 text-xs font-mono text-muted-foreground xl:inline-flex">
              {hasContract ? `${shorten(SHIELDSCORE_ADDRESS)} / ${chainId}` : "Demo"}
            </span>
            <ActionButton onClick={connectWallet} disabled={busy} variant={account ? "outline" : "solid"}>
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">{account ? shorten(account) : "Connect"}</span>
            </ActionButton>
          </div>
        </div>
      </header>

      <section className="border-b border-foreground/10">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-foreground/10 bg-background/70 px-3 py-2">
            <StatusRailItem label="Score" value={effectiveScore || "Not live"} tone={effectiveScore ? "success" : "neutral"} />
            <StatusRailItem label="Loans" value={loans.length} tone={activeLoans.length ? "warning" : "neutral"} />
            <StatusRailItem label="Pools" value={pools.length} tone={pools.length ? "success" : "neutral"} />
            <StatusRailItem
              label="State"
              value={deploymentIssue ? "Attention" : busy ? "Pending" : "Ready"}
              tone={deploymentIssue || busy ? "warning" : "success"}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {deploymentIssue && (
              <Panel className="flex flex-col gap-4 border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">Deployment attention</p>
                    <p className="mt-1 max-w-4xl text-sm leading-relaxed">{deploymentIssue}</p>
                  </div>
                </div>
                <a href="/api/health" className="inline-flex shrink-0 items-center gap-2 text-sm font-medium">
                  Health endpoint <ExternalLink className="h-4 w-4" />
                </a>
              </Panel>
            )}
            <PageHeader
              label="Dashboard"
              title="Credit workspace"
              detail="Score, eligibility, loans, and on-chain activity in one calm view."
              actions={
                <DashboardBadge tone={dashboardStatusTone}>
                  <span className={cn("h-2 w-2 rounded-full", busy || scoreStale ? "bg-amber-600" : effectiveScore ? "bg-emerald-600" : "bg-foreground/40")} />
                  {dashboardStatusLabel}
                </DashboardBadge>
              }
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DashboardMetric
                icon={ShieldCheck}
                label="Published score"
                value={effectiveScore || "Not live"}
                detail={effectiveScore ? `${scoreTier} tier, updated ${latestScoreEntry ? formatTime(latestScoreEntry.publishedAt) : formatTime(profile.scorePublishedAt)}` : "Generate a private snapshot first."}
              />
              <DashboardMetric
                icon={Landmark}
                label="Eligible pools"
                value={`${qualifiedPools.length}/${activePoolCount}`}
                detail={activePoolCount ? "Live pools matching this wallet." : "No live pools loaded yet."}
              />
              <DashboardMetric
                icon={Banknote}
                label="Active loans"
                value={activeLoans.length}
                detail={selectedLoanPool ? `${assetSymbol(selectedLoanPool)} due ${selectedLoan ? formatTime(selectedLoan.dueTime) : "n/a"}` : "No open loans."}
              />
              <DashboardMetric
                icon={BadgeCheck}
                label="Repayment health"
                value={repaymentTotal ? `${repaymentRate}%` : "Clean"}
                detail={repaymentTotal ? `${profile.loansRepaid} on-time, ${profile.loansRepaidLate} late.` : "No completed loans recorded."}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
                  <Panel className="p-5">
                    <div className="mb-6 flex items-center justify-between gap-4">
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Readiness</span>
                      <Gauge className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-6">
                      <DashboardProgress label="Score range" value={scoreProgress} detail={`${effectiveScore || 0} / 850`} />
                      <DashboardProgress label="Repayment" value={repaymentTotal ? repaymentRate : 100} detail={repaymentTotal ? `${repaymentTotal} closed events` : "No closed loans yet"} />
                      <DashboardProgress label="Snapshots" value={Math.min(100, profile.snapshotsSubmitted * 25)} detail={`${profile.snapshotsSubmitted} encrypted snapshot${profile.snapshotsSubmitted === 1 ? "" : "s"}`} />
                    </div>
                  </Panel>

                  <Panel className="p-5">
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Score history</span>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {latestScoreEntry ? `${latestScoreEntry.score} on ${formatTime(latestScoreEntry.publishedAt)}` : "No published timeline yet."}
                        </p>
                      </div>
                      <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="h-64">
                      {displayedScoreHistory.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={displayedScoreHistory.map((item) => ({ date: formatTime(item.publishedAt), score: item.score }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                            <YAxis domain={[300, 850]} tickLine={false} axisLine={false} fontSize={12} width={36} />
                            <Tooltip />
                            <Line type="monotone" dataKey="score" stroke="currentColor" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-md border border-dashed border-foreground/15 px-6 text-center text-sm leading-relaxed text-muted-foreground">
                          Publish a score to draw the timeline.
                        </div>
                      )}
                    </div>
                  </Panel>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Panel>
                    <div className="flex items-center justify-between border-b border-foreground/10 p-5">
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Activity</span>
                      <RefreshCw className={cn("h-4 w-4 text-muted-foreground", busy && "animate-spin")} />
                    </div>
                    <div className="divide-y divide-foreground/10">
                      {activityLog.map((item, index) => (
                        <div key={`${item}-${index}`} className="flex items-start gap-3 p-4">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-foreground/55" />
                          <span className="text-sm leading-relaxed">{item}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel>
                    <div className="flex items-start justify-between gap-4 border-b border-foreground/10 p-5">
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Transactions</span>
                      {lastGasEstimate && <span className="shrink-0 text-xs font-mono text-muted-foreground">Gas {lastGasEstimate.toString()}</span>}
                    </div>
                    <div className="divide-y divide-foreground/10">
                      {txHistory.length === 0 && <div className="p-5 text-sm leading-relaxed text-muted-foreground">No wallet transactions in this session.</div>}
                      {txHistory.map((tx) => (
                        <a
                          key={tx.hash}
                          href={tx.explorerUrl || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-4 p-4 text-sm transition-colors hover:bg-foreground/[0.03]"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{tx.label}</p>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{shorten(tx.hash)}</p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-mono uppercase",
                              tx.status === "confirmed" && "border-emerald-500/25 text-emerald-700",
                              tx.status === "pending" && "border-amber-500/25 text-amber-700",
                              tx.status === "failed" && "border-red-500/25 text-red-700"
                            )}
                          >
                            {tx.status}
                            {tx.explorerUrl && <ExternalLink className="h-3 w-3" />}
                          </span>
                        </a>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>

              <aside className="space-y-6">
                <Panel className="p-5">
                  <SectionLabel>Next action</SectionLabel>
                  <div className="mt-6 flex h-11 w-11 items-center justify-center rounded-md bg-foreground text-background">
                    <DashboardActionIcon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-5 font-display text-3xl leading-tight">{dashboardAction.label}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{dashboardAction.detail}</p>
                  <div className="mt-5">
                    {dashboardAction.href ? (
                      <ActionLink href={dashboardAction.href}>
                        Continue <ArrowRight className="h-4 w-4" />
                      </ActionLink>
                    ) : (
                      <ActionButton onClick={connectWallet} disabled={busy}>
                        Connect <Wallet className="h-4 w-4" />
                      </ActionButton>
                    )}
                  </div>
                </Panel>

                <Panel className="divide-y divide-foreground/10">
                  {[
                    { label: "Score freshness", value: scoreStale ? "Refresh" : effectiveScore ? "Current" : "No score", ok: !scoreStale && Boolean(effectiveScore) },
                    { label: "Market access", value: `${qualifiedPools.length} eligible`, ok: qualifiedPools.length > 0 },
                    { label: "Repayments", value: activeLoans.length ? `${activeLoans.length} active` : "Clear", ok: activeLoans.length === 0 },
                    { label: "Attestations", value: `${attestations.filter((item) => !item.revoked).length} active`, ok: attestations.some((item) => !item.revoked) },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4 p-4">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="mt-1 text-xs font-mono text-muted-foreground">{item.value}</p>
                      </div>
                      {item.ok ? <Check className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
                    </div>
                  ))}
                </Panel>
              </aside>
            </div>
          </div>
        )}

        {activeTab === "score" && (
          <div className="space-y-6">
            <PageHeader
              label="Score"
              title="Generate verified score"
              detail="Encrypt wallet signals, publish only the final score."
              actions={
                <>
                  <ActionButton onClick={importWalletData} disabled={busy || !account} variant="outline">
                    <Search className="h-4 w-4" />
                    Import
                  </ActionButton>
                  <ActionButton onClick={() => generateScore(false)} disabled={busy || (hasContract && (!account || !cofheClient))}>
                    <KeyRound className="h-4 w-4" />
                    Publish
                  </ActionButton>
                  <ActionButton onClick={() => generateScore(true)} disabled={busy || profile.snapshotsSubmitted === 0 || (hasContract && (!account || !cofheClient))} variant="outline">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </ActionButton>
                </>
              }
            />

            <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
              <Panel className="p-5">
                <span className="text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">Projected score</span>
                <div className="mt-4 font-display text-7xl leading-none">{projectedScore}</div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(0, Math.min(100, ((projectedScore - 300) / 550) * 100))}%` }} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Published</span>
                    <p className="mt-1 font-medium">{profile.publicScore || "Not live"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Snapshots</span>
                    <p className="mt-1 font-medium">{profile.snapshotsSubmitted}</p>
                  </div>
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Inputs</span>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-5">
                  {factors.map((factor) => (
                    <div key={factor.key}>
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{factor.label}</div>
                          <div className="text-xs font-mono text-muted-foreground">Weight {factor.weight}</div>
                        </div>
                        <span className="font-display text-3xl">{snapshot[factor.key]}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={snapshot[factor.key]}
                        onChange={(event) =>
                          setSnapshot((current) => ({ ...current, [factor.key]: Number(event.target.value) }))
                        }
                        className="w-full accent-foreground"
                      />
                    </div>
                  ))}
                </div>
              </Panel>

              {signalTrends.length > 0 && (
                <Panel className="p-5 lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Category trends</span>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={signalTrends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="previous" fill="rgba(0,0,0,0.18)" />
                        <Bar dataKey="value" fill="currentColor" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        )}

        {activeTab === "marketplace" && (
          <div className="space-y-6">
            <PageHeader
              label="Marketplace"
              title="Borrow from live pools"
              detail="Choose a pool, check score fit, and draw liquidity."
              actions={
                <Panel className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
                  <SelectField label="Pool" value={borrowForm.poolId} onChange={(poolId) => setBorrowForm((current) => ({ ...current, poolId }))}>
                    {pools.map((pool) => (
                      <option key={pool.id} value={pool.id}>
                        Pool {pool.id}
                      </option>
                    ))}
                  </SelectField>
                  <TextInput label="Amount" value={borrowForm.amount} onChange={(amount) => setBorrowForm((current) => ({ ...current, amount }))} suffix={assetSymbol(selectedPool)} />
                  <ActionButton onClick={borrow} disabled={busy || (hasContract && !account) || scoreStale || !selectedPool || profile.publicScore < (selectedPool?.minScore || 0)}>
                    Borrow <ArrowRight className="h-4 w-4" />
                  </ActionButton>
                </Panel>
              }
            />

            {scoreStale && <p className="text-sm text-muted-foreground">Refresh your score before borrowing again.</p>}

            <div className="grid gap-4 lg:grid-cols-3">
              {pools.length === 0 && (
                <Panel className="p-6 text-sm leading-relaxed text-muted-foreground lg:col-span-3">
                  No live pools are available from the configured contract yet.
                </Panel>
              )}
              {pools.map((pool) => {
                const qualifies = profile.publicScore >= pool.minScore;
                return (
                  <Panel key={pool.id} className="p-5">
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Pool {pool.id}</span>
                      <span className={cn("rounded-md border px-2.5 py-1 text-xs font-mono uppercase", qualifies ? "border-emerald-500/25 text-emerald-700" : "border-foreground/10 text-muted-foreground")}>
                        {qualifies ? "Qualified" : "Gated"}
                      </span>
                    </div>
                    <div className="font-display text-4xl leading-none">{formatAssetAmount(pool, pool.liquidity)}</div>
                    <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                      <span className="text-muted-foreground">Asset</span>
                      <span>{assetSymbol(pool)}</span>
                      <span className="text-muted-foreground">Min score</span>
                      <span>{pool.minScore}</span>
                      <span className="text-muted-foreground">Interest</span>
                      <span>{asPercent(pool.interestBps)}</span>
                      <span className="text-muted-foreground">Max loan</span>
                      <span>{formatAssetAmount(pool, pool.maxLoanAmount)}</span>
                      <span className="text-muted-foreground">Collateral</span>
                      <span>{asPercent(Math.min(pool.baseCollateralBps, collateralBpsForScore(profile.publicScore)))}</span>
                    </div>
                  </Panel>
                );
              })}
            </div>

            <Panel className="p-4 text-sm text-muted-foreground">
              Required collateral: {formatEth(requiredCollateral)} at {asPercent(borrowCollateralBps)}.
            </Panel>
          </div>
        )}

        {activeTab === "create" && (
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Lender desk</SectionLabel>
              <h2 className="mt-6 font-display text-5xl leading-none">Create a score-gated pool.</h2>
              <p className="mt-6 text-lg text-muted-foreground">Liquidity, thresholds, term length, and collateral policy are written directly to the protocol.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">Asset</span>
                <select
                  value={poolForm.assetType}
                  onChange={(event) => setPoolForm((current) => ({ ...current, assetType: event.target.value }))}
                  className="h-12 w-full border border-foreground/10 bg-background px-4 text-sm outline-none"
                >
                  <option value="native">Native ETH</option>
                  <option value="erc20">ERC-20 / ssUSDC</option>
                </select>
              </label>
              {poolForm.assetType === "erc20" && (
                <TextInput
                  label="Token"
                  value={poolForm.tokenAddress}
                  onChange={(tokenAddress) => setPoolForm((current) => ({ ...current, tokenAddress }))}
                  disabled={Boolean(SHIELDSCORE_USDC_ADDRESS)}
                />
              )}
              <TextInput label="Minimum score" value={poolForm.minScore} onChange={(minScore) => setPoolForm((current) => ({ ...current, minScore }))} />
              <TextInput label="Collateral cap" value={poolForm.collateral} onChange={(collateral) => setPoolForm((current) => ({ ...current, collateral }))} suffix="%" />
              <TextInput label="Interest APY" value={poolForm.interest} onChange={(interest) => setPoolForm((current) => ({ ...current, interest }))} suffix="%" />
              <TextInput label="Duration" value={poolForm.duration} onChange={(duration) => setPoolForm((current) => ({ ...current, duration }))} suffix="days" />
              {poolForm.assetType === "erc20" && (
                <TextInput
                  label="ETH price"
                  value={poolForm.collateralPrice}
                  onChange={(collateralPrice) => setPoolForm((current) => ({ ...current, collateralPrice }))}
                  suffix="ETH/token"
                  disabled={Boolean(SHIELDSCORE_USDC_ADDRESS)}
                />
              )}
              <TextInput label="Max loan" value={poolForm.maxLoan} onChange={(maxLoan) => setPoolForm((current) => ({ ...current, maxLoan }))} suffix={poolForm.assetType === "native" ? "ETH" : "ssUSDC"} />
              <TextInput label="Initial liquidity" value={poolForm.liquidity} onChange={(liquidity) => setPoolForm((current) => ({ ...current, liquidity }))} suffix={poolForm.assetType === "native" ? "ETH" : "ssUSDC"} />
              <div className="md:col-span-2">
                <ActionButton onClick={createPool} disabled={busy || (hasContract && !account)}>
                  <Coins className="h-4 w-4" />
                  Create pool
                </ActionButton>
                {poolForm.assetType === "erc20" && SHIELDSCORE_USDC_ADDRESS && (
                  <span className="ml-3 inline-flex">
                    <ActionButton onClick={faucetUsdc} disabled={busy || (hasContract && !account)} variant="outline">
                      <Banknote className="h-4 w-4" />
                      Faucet
                    </ActionButton>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "repayments" && (
          <div>
            <div className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <SectionLabel>Repayment tracker</SectionLabel>
                <h2 className="mt-6 font-display text-5xl leading-none">Keep the score climbing.</h2>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label>
                  <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">Active loan</span>
                  <select
                    value={selectedLoanId}
                    onChange={(event) => setSelectedLoanId(event.target.value)}
                    className="h-11 border border-foreground/10 bg-background px-4 text-sm outline-none"
                  >
                    {activeLoans.map((loan) => (
                      <option key={loan.id} value={loan.id}>
                        Loan {loan.id}
                      </option>
                    ))}
                  </select>
                </label>
                <ActionButton onClick={repay} disabled={busy || !selectedLoan}>
                  Repay due
                </ActionButton>
                <ActionButton onClick={() => generateScore(true)} disabled={busy || profile.snapshotsSubmitted === 0} variant="outline">
                  <RefreshCw className="h-4 w-4" />
                  Refresh score
                </ActionButton>
              </div>
            </div>
            <div className="divide-y divide-foreground/10 border-y border-foreground/10">
              {loans.length === 0 && <div className="py-10 text-muted-foreground">No borrower loans found.</div>}
              {loans.map((loan) => {
                const pool = pools.find((item) => item.id === loan.poolId);
                return (
                <div key={loan.id} className="grid gap-6 py-6 md:grid-cols-7 md:items-center">
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Loan</span>
                    <div className="font-display text-3xl">#{loan.id}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Asset</span>
                    <div>{assetSymbol(pool)}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Principal</span>
                    <div>{formatAssetAmount(pool, loan.principal)}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Interest</span>
                    <div>{formatAssetAmount(pool, loan.interest, 6)}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Collateral</span>
                    <div>{formatEth(loan.collateral)}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Status</span>
                    <div>{["Active", "Repaid", "Defaulted"][loan.status]}</div>
                  </div>
                  <div className="flex justify-start md:justify-end">
                    {loan.status === 0 && Date.now() / 1000 > loan.dueTime && (
                      <ActionButton onClick={() => markDefault(loan.id)} disabled={busy} variant="outline">
                        <CircleAlert className="h-4 w-4" />
                        Default
                      </ActionButton>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "attestations" && (
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Score attestation</SectionLabel>
              <h2 className="mt-6 font-display text-5xl leading-none">Share a threshold proof.</h2>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end">
                <TextInput label="Threshold" value={attestationThreshold} onChange={setAttestationThreshold} />
                <ActionButton onClick={issueAttestation} disabled={busy || profile.publicScore < Number(attestationThreshold)}>
                  <BadgeCheck className="h-4 w-4" />
                  Issue
                </ActionButton>
              </div>
              <div className="mt-10 space-y-4 border border-foreground/10 p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase text-muted-foreground">Verify by id</span>
                  <Search className="h-4 w-4 text-muted-foreground" />
                </div>
                <TextInput label="Attestation id" value={verifyForm.id} onChange={(id) => setVerifyForm((current) => ({ ...current, id }))} />
                <TextInput label="Owner" value={verifyForm.owner} onChange={(owner) => setVerifyForm((current) => ({ ...current, owner }))} />
                <div className="flex flex-wrap items-end gap-3">
                  <TextInput label="Threshold" value={verifyForm.threshold} onChange={(threshold) => setVerifyForm((current) => ({ ...current, threshold }))} />
                  <ActionButton onClick={verifyAttestation} disabled={busy}>
                    Verify
                  </ActionButton>
                  {verifyResult && <span className="pb-3 text-sm text-muted-foreground">{verifyResult}</span>}
                </div>
              </div>
            </div>
            <div className="divide-y divide-foreground/10 border-y border-foreground/10">
              {attestations.map((attestation) => (
                <div key={attestation.id} className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{attestation.id}</div>
                    <div className="mt-2 text-sm">
                      Score {attestation.scoreAtIssue} met threshold {attestation.threshold}
                      {attestation.revoked ? " / revoked" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <ActionButton onClick={() => copyAttestation(attestation.id)} variant="outline">
                      <Link2 className="h-4 w-4" />
                      Share
                    </ActionButton>
                    <ActionButton onClick={() => revokeAttestation(attestation.id)} disabled={busy || attestation.revoked} variant="outline">
                      <CircleAlert className="h-4 w-4" />
                      Revoke
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "risk" && (
          <div>
            <div className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <SectionLabel>Lender risk</SectionLabel>
                <h2 className="mt-6 font-display text-5xl leading-none">Pool health and controls.</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-3 sm:grid-cols-[120px_1fr_auto]">
                  <label>
                    <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">Pool</span>
                    <select
                      value={fundForm.poolId}
                      onChange={(event) => setFundForm((current) => ({ ...current, poolId: event.target.value }))}
                      className="h-12 w-full border border-foreground/10 bg-background px-4 text-sm outline-none"
                    >
                      {pools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextInput label="Fund pool" value={fundForm.amount} onChange={(amount) => setFundForm((current) => ({ ...current, amount }))} suffix={assetSymbol(selectedFundPool)} />
                  <div className="self-end">
                    <ActionButton
                      onClick={fundPool}
                      disabled={busy || !selectedFundPool || !isPoolLender(selectedFundPool)}
                      ariaLabel="Fund selected pool"
                      title="Fund selected pool"
                    >
                      <Banknote className="h-4 w-4" />
                    </ActionButton>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[120px_1fr_auto]">
                  <label>
                    <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">Pool</span>
                    <select
                      value={withdrawForm.poolId}
                      onChange={(event) => setWithdrawForm((current) => ({ ...current, poolId: event.target.value }))}
                      className="h-12 w-full border border-foreground/10 bg-background px-4 text-sm outline-none"
                    >
                      {pools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextInput label="Withdraw" value={withdrawForm.amount} onChange={(amount) => setWithdrawForm((current) => ({ ...current, amount }))} suffix={assetSymbol(selectedWithdrawPool)} />
                  <div className="self-end">
                    <ActionButton
                      onClick={withdraw}
                      disabled={busy || !selectedWithdrawPool || !isPoolLender(selectedWithdrawPool)}
                      ariaLabel="Withdraw from selected pool"
                      title="Withdraw from selected pool"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </ActionButton>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-px bg-foreground/10 lg:grid-cols-3">
              {pools.length === 0 && (
                <div className="bg-background p-8 text-sm leading-relaxed text-muted-foreground lg:col-span-3">
                  Pool controls will appear after the configured contract returns live pools.
                </div>
              )}
              {pools.map((pool) => (
                <div key={pool.id} className="bg-background p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="font-mono text-xs uppercase text-muted-foreground">Pool {pool.id}</span>
                    <button
                      type="button"
                      onClick={() => togglePool(pool)}
                      disabled={busy || !isPoolLender(pool)}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      title={isPoolLender(pool) ? (pool.active ? "Pause pool" : "Reactivate pool") : "Only the lender can change this pool"}
                    >
                      {pool.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="grid gap-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Asset</span>
                      <span>{assetSymbol(pool)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Liquidity</span>
                      <span>{formatAssetAmount(pool, pool.liquidity)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Utilization</span>
                      <span>{asPercent(pool.utilizationBps)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Average score</span>
                      <span>{pool.averageScore || "n/a"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Default rate</span>
                      <span>{asPercent(pool.defaultRateBps)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Interest earned</span>
                      <span>{formatAssetAmount(pool, pool.interestEarned, 6)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Expected yield</span>
                      <span>{asPercent(pool.expectedYieldBps)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Recovered collateral</span>
                      <span>{formatEth(pool.recoveredCollateral, 6)}</span>
                    </div>
                  </div>
                  {!isNativePool(pool) && pool.recoveredCollateral > 0n && (
                    <div className="mt-5">
                      <ActionButton onClick={() => withdrawRecoveredCollateral(pool)} disabled={busy || !isPoolLender(pool)} variant="outline">
                        Recover collateral
                      </ActionButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <div className="border border-foreground/10 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase text-muted-foreground">Cohort default curve</span>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={loanCohorts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="bps" fill="currentColor" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="border border-foreground/10 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase text-muted-foreground">Pool event timeline</span>
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-4">
                  {indexedData.poolTimeline.slice(0, 6).map((event) => (
                    <div key={`${event.transactionHash}-${event.label}`} className="flex justify-between gap-4 text-sm">
                      <span>{event.label}</span>
                      <span className="text-muted-foreground">{formatTime(event.timestamp)}</span>
                    </div>
                  ))}
                  {indexedData.poolTimeline.length === 0 && <p className="text-sm text-muted-foreground">Pool events will appear after the indexer syncs.</p>}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
