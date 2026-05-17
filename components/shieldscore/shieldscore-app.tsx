"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CircleAlert,
  Coins,
  Copy,
  FileCheck,
  KeyRound,
  Landmark,
  Lock,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  parseEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { arbitrumSepolia, hardhat, sepolia } from "viem/chains";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RPC_URL,
  SHIELDSCORE_ADDRESS,
  SHIELDSCORE_CHAIN_ID,
  shieldScoreAbi,
  type CreditProfile,
  type LendingPool,
  type Loan,
  type ScoreAttestation,
} from "@/lib/shieldscore-contract";
import { demoAttestations, demoLoans, demoPools, demoProfile } from "@/lib/shieldscore-demo";

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

type SnapshotInputs = {
  balanceConsistency: number;
  repaymentHistory: number;
  walletAge: number;
  protocolDiversity: number;
  incomeConsistency: number;
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
  snapshotsSubmitted: 0,
  loansRepaid: 0,
  loansDefaulted: 0,
  totalBorrowed: 0n,
  totalRepaid: 0n,
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

function safeParseEther(value: string) {
  try {
    return parseEther(value && Number(value) > 0 ? value : "0");
  } catch {
    return 0n;
  }
}

function formatEth(value: bigint, digits = 4) {
  const formatted = Number(formatEther(value));
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
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
    snapshotsSubmitted: Number(tuple[3]),
    loansRepaid: Number(tuple[4]),
    loansDefaulted: Number(tuple[5]),
    totalBorrowed: tuple[6] as bigint,
    totalRepaid: tuple[7] as bigint,
  };
}

function poolFromTuple(id: number, tuple: readonly unknown[], health: readonly unknown[]): LendingPool {
  return {
    id,
    lender: tuple[0] as Address,
    minScore: Number(tuple[1]),
    baseCollateralBps: Number(tuple[2]),
    interestBps: Number(tuple[3]),
    durationSeconds: Number(tuple[4]),
    maxLoanAmount: tuple[5] as bigint,
    liquidity: tuple[6] as bigint,
    totalSupplied: tuple[7] as bigint,
    totalBorrowed: tuple[8] as bigint,
    totalRepaid: tuple[9] as bigint,
    interestEarned: tuple[10] as bigint,
    defaultedPrincipal: tuple[11] as bigint,
    borrowerScoreTotal: tuple[12] as bigint,
    loanCount: Number(tuple[13]),
    defaultCount: Number(tuple[14]),
    active: Boolean(tuple[15]),
    utilizationBps: Number(health[0]),
    averageScore: Number(health[1]),
    defaultRateBps: Number(health[2]),
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
    <span className="inline-flex items-center gap-3 text-xs font-mono uppercase text-muted-foreground">
      <span className="h-px w-8 bg-foreground/30" />
      {children}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition-all disabled:pointer-events-none disabled:opacity-50",
        variant === "solid"
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "border border-foreground/15 text-foreground hover:border-foreground/40 hover:bg-foreground/[0.03]"
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition-all",
        variant === "solid"
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "border border-foreground/15 text-foreground hover:border-foreground/40 hover:bg-foreground/[0.03]"
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">{label}</span>
      <span className="flex h-12 items-center border border-foreground/10 bg-background px-4 focus-within:border-foreground/40">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          inputMode="decimal"
        />
        {suffix && <span className="ml-3 text-xs font-mono text-muted-foreground">{suffix}</span>}
      </span>
    </label>
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
  const [snapshot, setSnapshot] = useState<SnapshotInputs>(defaultSnapshot);
  const [poolForm, setPoolForm] = useState({
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
  const [selectedLoanId, setSelectedLoanId] = useState("1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(hasContract ? "Ready for wallet connection" : "Demo mode: set NEXT_PUBLIC_SHIELDSCORE_ADDRESS for live chain writes");
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
  const projectedScore = scoreFromSnapshot(snapshot);
  const effectiveScore = profile.publicScore || (!hasContract ? projectedScore : 0);
  const scoreTier = effectiveScore >= 800 ? "Prime" : effectiveScore >= 700 ? "Strong" : effectiveScore >= 600 ? "Qualified" : effectiveScore >= 500 ? "Watchlist" : "No score";
  const borrowPrincipal = safeParseEther(borrowForm.amount);
  const borrowCollateralBps = selectedPool
    ? Math.min(selectedPool.baseCollateralBps, collateralBpsForScore(effectiveScore))
    : 0;
  const requiredCollateral = selectedPool ? (borrowPrincipal * BigInt(borrowCollateralBps)) / 10_000n : 0n;
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
      const poolTotal = Number(await withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "poolCount" } as any)));
      const nextPools = await Promise.all(
        Array.from({ length: poolTotal }, async (_, index) => {
          const id = index + 1;
          const [poolTuple, healthTuple] = await Promise.all([
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "pools", args: [BigInt(id)] } as any)),
            withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "poolHealth", args: [BigInt(id)] } as any)),
          ]);
          return poolFromTuple(id, poolTuple as readonly unknown[], healthTuple as readonly unknown[]);
        })
      );
      setPools(nextPools);

      if (owner) {
        const [profileTuple, loanIds, attestationIds] = await Promise.all([
          withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "profiles", args: [owner] } as any)),
          withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "borrowerLoanIds", args: [owner] } as any)),
          withTimeout(client.readContract({ address: contractAddress, abi: shieldScoreAbi, functionName: "ownerAttestationIds", args: [owner] } as any)),
        ]);
        setProfile(profileFromTuple(profileTuple as readonly unknown[]));

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
      } else {
        setProfile(emptyProfile);
        setLoans([]);
        setAttestations([]);
      }

      setStatus("On-chain state synced");
      } catch {
        setPools(demoPools);
        if (!owner) {
          setProfile(emptyProfile);
          setLoans([]);
          setAttestations([]);
        }
        setStatus("Using cached pool snapshot");
      }
    },
    [account, hasContract, publicClient, readOnlyClient]
  );

  useEffect(() => {
    refreshData().catch(() => setStatus("Unable to read configured contract"));
  }, [refreshData]);

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

  const writeContract = async (functionName: string, args: unknown[], value?: bigint) => {
    if (!hasContract || !SHIELDSCORE_ADDRESS || !walletClient || !publicClient || !account) {
      throw new Error("Wallet or contract not ready");
    }
    if (chainId !== SHIELDSCORE_CHAIN_ID && window.ethereum) {
      setStatus(`Switching wallet to ${getViemChain(SHIELDSCORE_CHAIN_ID).name}`);
      await switchWalletToProtocolChain(window.ethereum);
      setChainId(SHIELDSCORE_CHAIN_ID);
    }
    const hash = await walletClient.writeContract({
      address: SHIELDSCORE_ADDRESS,
      abi: shieldScoreAbi,
      functionName,
      args,
      account,
      chain: getViemChain(SHIELDSCORE_CHAIN_ID),
      value,
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await action();
      addLog(label);
      await refreshData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction failed");
    } finally {
      setBusy(false);
    }
  };

  const generateScore = async () => {
    await runAction("Encrypted score generated and published", async () => {
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
      const { Encryptable } = await import("@cofhe/sdk");
      const encrypted = await cofheClient
        .encryptInputs(factors.map((factor) => Encryptable.uint32(BigInt(snapshot[factor.key]))))
        .onStep((step: string) => setStatus(`Encrypting: ${step}`))
        .execute();
      await writeContract("submitEncryptedSnapshot", encrypted, undefined);
      const handle = await publicClient!.readContract({
        address: SHIELDSCORE_ADDRESS!,
        abi: shieldScoreAbi,
        functionName: "encryptedScoreOf",
        args: [account!],
      } as any);
      setStatus("Requesting CoFHE decrypt-for-transaction signature");
      const decrypted = await cofheClient.decryptForTx(handle).withoutPermit().execute();
      await writeContract("publishScore", [Number(decrypted.decryptedValue), decrypted.signature]);
    });
  };

  const createPool = async () => {
    await runAction("Lending pool created", async () => {
      const minScore = Number(poolForm.minScore);
      const baseCollateralBps = Math.round(Number(poolForm.collateral) * 100);
      const interestBps = Math.round(Number(poolForm.interest) * 100);
      const durationSeconds = Math.round(Number(poolForm.duration) * 24 * 60 * 60);
      const maxLoanAmount = safeParseEther(poolForm.maxLoan);
      const liquidity = safeParseEther(poolForm.liquidity);
      if (![minScore, baseCollateralBps, interestBps, durationSeconds].every(Number.isFinite)) {
        throw new Error("Pool terms must be valid numbers");
      }
      if (minScore < 300 || minScore > 850) throw new Error("Minimum score must be between 300 and 850");
      if (baseCollateralBps <= 0 || baseCollateralBps > 15_000) throw new Error("Collateral must be above 0% and no more than 150%");
      if (interestBps < 0 || interestBps > 5_000) throw new Error("Interest must be between 0% and 50%");
      if (durationSeconds <= 0) throw new Error("Duration must be at least one day");
      if (maxLoanAmount <= 0n || liquidity <= 0n) throw new Error("Loan and liquidity amounts must be above zero");
      if (maxLoanAmount > liquidity) throw new Error("Max loan cannot exceed initial liquidity");
      const newPool: LendingPool = {
        id: pools.length + 1,
        lender: account || "0x8a2d02d41483A492C636BFcC00fE9963F6eBB1e2",
        minScore,
        baseCollateralBps,
        interestBps,
        durationSeconds,
        maxLoanAmount,
        liquidity,
        totalSupplied: liquidity,
        totalBorrowed: 0n,
        totalRepaid: 0n,
        interestEarned: 0n,
        defaultedPrincipal: 0n,
        borrowerScoreTotal: 0n,
        loanCount: 0,
        defaultCount: 0,
        active: true,
        utilizationBps: 0,
        averageScore: 0,
        defaultRateBps: 0,
      };
      if (!hasContract) {
        setPools((current) => [newPool, ...current]);
        return;
      }
      await writeContract(
        "createPool",
        [minScore, baseCollateralBps, interestBps, durationSeconds, maxLoanAmount],
        liquidity
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
              ? { ...pool, liquidity: pool.liquidity - borrowPrincipal, totalBorrowed: pool.totalBorrowed + borrowPrincipal, loanCount: pool.loanCount + 1 }
              : pool
          )
        );
        return;
      }
      await writeContract("borrow", [BigInt(selectedPool.id), borrowPrincipal], requiredCollateral);
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
      await writeContract("repay", [BigInt(selectedLoan.id)], due);
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
      await writeContract("issueScoreAttestation", [threshold]);
    });
  };

  const markDefault = async (loanId: number) => {
    await runAction("Loan marked defaulted", async () => {
      if (!hasContract) {
        setLoans((current) => current.map((loan) => (loan.id === loanId ? { ...loan, status: 2 } : loan)));
        return;
      }
      await writeContract("markDefault", [BigInt(loanId)]);
    });
  };

  const togglePool = async (pool: LendingPool) => {
    await runAction(pool.active ? "Pool paused" : "Pool reactivated", async () => {
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can change pool status");
      if (!hasContract) {
        setPools((current) => current.map((item) => (item.id === pool.id ? { ...item, active: !item.active } : item)));
        return;
      }
      await writeContract("setPoolActive", [BigInt(pool.id), !pool.active]);
    });
  };

  const fundPool = async () => {
    await runAction("Pool funded", async () => {
      const poolId = Number(fundForm.poolId);
      const amount = safeParseEther(fundForm.amount);
      const pool = pools.find((item) => item.id === poolId);
      if (!pool) throw new Error("Select a pool to fund");
      if (amount <= 0n) throw new Error("Funding amount must be above zero");
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can fund this pool");
      if (!hasContract) {
        setPools((current) =>
          current.map((pool) => (pool.id === poolId ? { ...pool, liquidity: pool.liquidity + amount, totalSupplied: pool.totalSupplied + amount } : pool))
        );
        return;
      }
      await writeContract("fundPool", [BigInt(poolId)], amount);
    });
  };

  const withdraw = async () => {
    await runAction("Available liquidity withdrawn", async () => {
      const poolId = Number(withdrawForm.poolId);
      const amount = safeParseEther(withdrawForm.amount);
      const pool = pools.find((item) => item.id === poolId);
      if (!pool) throw new Error("Select a pool to withdraw from");
      if (amount <= 0n) throw new Error("Withdrawal amount must be above zero");
      if (amount > pool.liquidity) throw new Error("Withdrawal exceeds available liquidity");
      if (!isPoolLender(pool)) throw new Error("Only the pool lender can withdraw liquidity");
      if (!hasContract) {
        setPools((current) =>
          current.map((pool) => (pool.id === poolId ? { ...pool, liquidity: pool.liquidity > amount ? pool.liquidity - amount : 0n } : pool))
        );
        return;
      }
      await writeContract("withdrawAvailable", [BigInt(poolId), amount]);
    });
  };

  const copyAttestation = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setStatus("Attestation copied");
  };

  return (
    <main className="min-h-screen bg-background text-foreground noise-overlay">
      <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4 lg:px-12">
          <a href="/" className="font-display text-2xl">
            ShieldScore
          </a>
          <div className="hidden items-center gap-2 xl:flex">
            {tabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors",
                  activeTab === tab.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-mono text-muted-foreground md:inline">
              {hasContract ? `${shorten(SHIELDSCORE_ADDRESS)} / ${chainId}` : "demo"}
            </span>
            <ActionButton onClick={connectWallet} disabled={busy} variant={account ? "outline" : "solid"}>
              <Wallet className="h-4 w-4" />
              {account ? shorten(account) : "Connect"}
            </ActionButton>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1400px] gap-2 overflow-x-auto px-6 pb-4 xl:hidden">
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.href}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm",
                activeTab === tab.id ? "bg-foreground text-background" : "border border-foreground/10 text-muted-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </a>
          ))}
        </div>
      </header>

      <section className="border-b border-foreground/10">
        <div className="mx-auto grid max-w-[1400px] gap-px bg-foreground/10 px-6 lg:grid-cols-4 lg:px-12">
          {[
            { label: "Credit score", value: effectiveScore, sub: scoreTier },
            { label: "Borrowed", value: formatEth(profile.totalBorrowed), sub: `${profile.loansRepaid} repaid` },
            { label: "Pool liquidity", value: formatEth(pools.reduce((sum, pool) => sum + pool.liquidity, 0n)), sub: `${pools.length} pools` },
            { label: "Status", value: busy ? "Pending" : "Ready", sub: status },
          ].map((metric) => (
            <div key={metric.label} className="bg-background px-6 py-8">
              <span className="text-xs font-mono uppercase text-muted-foreground">{metric.label}</span>
              <div className="mt-3 font-display text-4xl">{metric.value}</div>
              <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{metric.sub}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 py-10 lg:px-12 lg:py-14">
        {activeTab === "dashboard" && (
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <SectionLabel>Borrower console</SectionLabel>
              <h1 className="mt-6 font-display text-5xl leading-none lg:text-7xl">
                Private credit,
                <br />
                public access.
              </h1>
              <div className="mt-10 grid gap-px bg-foreground/10 md:grid-cols-3">
                {[
                  ["Encrypted snapshots", profile.snapshotsSubmitted],
                  ["Loans repaid", profile.loansRepaid],
                  ["Defaults", profile.loansDefaulted],
                ].map(([label, value]) => (
                  <div key={label} className="bg-background p-6">
                    <div className="font-display text-4xl">{String(value)}</div>
                    <p className="mt-2 text-sm text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-10 flex flex-wrap gap-3">
                <ActionLink href="/score">
                  Generate score <ArrowRight className="h-4 w-4" />
                </ActionLink>
                <ActionLink href="/marketplace" variant="outline">
                  Browse pools
                </ActionLink>
              </div>
            </div>
            <div className="border border-foreground/10">
              <div className="flex items-center justify-between border-b border-foreground/10 p-5">
                <span className="font-mono text-xs uppercase text-muted-foreground">Activity</span>
                <RefreshCw className={cn("h-4 w-4 text-muted-foreground", busy && "animate-spin")} />
              </div>
              <div className="divide-y divide-foreground/10">
                {activityLog.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-center gap-4 p-5">
                    <span className="h-2 w-2 rounded-full bg-foreground" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "score" && (
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionLabel>Encrypted score engine</SectionLabel>
              <h2 className="mt-6 font-display text-5xl leading-none">Generate a verified score.</h2>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Inputs are encrypted client-side with CoFHE, scored in the contract, and only the final score is published.
              </p>
              <div className="mt-8 border border-foreground/10 p-6">
                <span className="text-xs font-mono uppercase text-muted-foreground">Projected score</span>
                <div className="mt-3 font-display text-7xl">{projectedScore}</div>
                <p className="mt-2 text-sm text-muted-foreground">Final score is verified by decrypt-for-transaction before publish.</p>
              </div>
            </div>
            <div className="space-y-6">
              {factors.map((factor) => (
                <div key={factor.key} className="border-b border-foreground/10 pb-5">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{factor.label}</div>
                      <div className="text-xs font-mono text-muted-foreground">Weight {factor.weight}</div>
                    </div>
                    <span className="font-display text-4xl">{snapshot[factor.key]}</span>
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
              <ActionButton onClick={generateScore} disabled={busy}>
                <KeyRound className="h-4 w-4" />
                Encrypt and publish score
              </ActionButton>
            </div>
          </div>
        )}

        {activeTab === "marketplace" && (
          <div>
            <div className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <SectionLabel>Lending marketplace</SectionLabel>
                <h2 className="mt-6 font-display text-5xl leading-none">Pools you can draw from.</h2>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label>
                  <span className="mb-2 block text-xs font-mono uppercase text-muted-foreground">Pool</span>
                  <select
                    value={borrowForm.poolId}
                    onChange={(event) => setBorrowForm((current) => ({ ...current, poolId: event.target.value }))}
                    className="h-11 border border-foreground/10 bg-background px-4 text-sm outline-none"
                  >
                    {pools.map((pool) => (
                      <option key={pool.id} value={pool.id}>
                        Pool {pool.id}
                      </option>
                    ))}
                  </select>
                </label>
                <TextInput label="Amount" value={borrowForm.amount} onChange={(amount) => setBorrowForm((current) => ({ ...current, amount }))} suffix="ETH" />
                <ActionButton onClick={borrow} disabled={busy || !selectedPool || profile.publicScore < (selectedPool?.minScore || 0)}>
                  Borrow <ArrowRight className="h-4 w-4" />
                </ActionButton>
              </div>
            </div>
            <div className="grid gap-px bg-foreground/10 lg:grid-cols-3">
              {pools.map((pool) => {
                const qualifies = profile.publicScore >= pool.minScore;
                return (
                  <div key={pool.id} className="bg-background p-6">
                    <div className="mb-6 flex items-center justify-between">
                      <span className="font-mono text-xs uppercase text-muted-foreground">Pool {pool.id}</span>
                      <span className={cn("text-xs font-mono", qualifies ? "text-green-700" : "text-muted-foreground")}>
                        {qualifies ? "Qualified" : "Score gated"}
                      </span>
                    </div>
                    <div className="font-display text-4xl">{formatEth(pool.liquidity)}</div>
                    <div className="mt-6 grid grid-cols-2 gap-5 text-sm">
                      <span className="text-muted-foreground">Min score</span>
                      <span>{pool.minScore}</span>
                      <span className="text-muted-foreground">Interest</span>
                      <span>{asPercent(pool.interestBps)}</span>
                      <span className="text-muted-foreground">Max loan</span>
                      <span>{formatEth(pool.maxLoanAmount)}</span>
                      <span className="text-muted-foreground">Collateral</span>
                      <span>{asPercent(Math.min(pool.baseCollateralBps, collateralBpsForScore(profile.publicScore)))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Required collateral for selected borrow: {formatEth(requiredCollateral)} at {asPercent(borrowCollateralBps)}.
            </p>
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
              <TextInput label="Minimum score" value={poolForm.minScore} onChange={(minScore) => setPoolForm((current) => ({ ...current, minScore }))} />
              <TextInput label="Collateral cap" value={poolForm.collateral} onChange={(collateral) => setPoolForm((current) => ({ ...current, collateral }))} suffix="%" />
              <TextInput label="Interest APY" value={poolForm.interest} onChange={(interest) => setPoolForm((current) => ({ ...current, interest }))} suffix="%" />
              <TextInput label="Duration" value={poolForm.duration} onChange={(duration) => setPoolForm((current) => ({ ...current, duration }))} suffix="days" />
              <TextInput label="Max loan" value={poolForm.maxLoan} onChange={(maxLoan) => setPoolForm((current) => ({ ...current, maxLoan }))} suffix="ETH" />
              <TextInput label="Initial liquidity" value={poolForm.liquidity} onChange={(liquidity) => setPoolForm((current) => ({ ...current, liquidity }))} suffix="ETH" />
              <div className="md:col-span-2">
                <ActionButton onClick={createPool} disabled={busy}>
                  <Coins className="h-4 w-4" />
                  Create pool
                </ActionButton>
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
              </div>
            </div>
            <div className="divide-y divide-foreground/10 border-y border-foreground/10">
              {loans.length === 0 && <div className="py-10 text-muted-foreground">No borrower loans found.</div>}
              {loans.map((loan) => (
                <div key={loan.id} className="grid gap-6 py-6 md:grid-cols-6 md:items-center">
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Loan</span>
                    <div className="font-display text-3xl">#{loan.id}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Principal</span>
                    <div>{formatEth(loan.principal)}</div>
                  </div>
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">Interest</span>
                    <div>{formatEth(loan.interest, 6)}</div>
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
              ))}
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
            </div>
            <div className="divide-y divide-foreground/10 border-y border-foreground/10">
              {attestations.map((attestation) => (
                <div key={attestation.id} className="grid gap-4 py-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{attestation.id}</div>
                    <div className="mt-2 text-sm">
                      Score {attestation.scoreAtIssue} met threshold {attestation.threshold}
                    </div>
                  </div>
                  <ActionButton onClick={() => copyAttestation(attestation.id)} variant="outline">
                    <Copy className="h-4 w-4" />
                    Copy
                  </ActionButton>
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
                  <TextInput label="Fund pool" value={fundForm.amount} onChange={(amount) => setFundForm((current) => ({ ...current, amount }))} suffix="ETH" />
                  <div className="self-end">
                  <ActionButton onClick={fundPool} disabled={busy || !selectedFundPool || !isPoolLender(selectedFundPool)}>
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
                  <TextInput label="Withdraw" value={withdrawForm.amount} onChange={(amount) => setWithdrawForm((current) => ({ ...current, amount }))} suffix="ETH" />
                  <div className="self-end">
                  <ActionButton onClick={withdraw} disabled={busy || !selectedWithdrawPool || !isPoolLender(selectedWithdrawPool)}>
                    <ArrowRight className="h-4 w-4" />
                  </ActionButton>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-px bg-foreground/10 lg:grid-cols-3">
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
                      <span>{formatEth(pool.interestEarned, 6)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
