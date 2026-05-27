import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CREDIT_AUTHORIZATION_TYPES,
  creditAuthorizationDomain,
  creditInputsHash,
  type EncryptedInputLike,
} from "@/lib/credit-authorization";
import { ingestWalletCreditSignals } from "@/lib/credit-ingestion";
import {
  DEFAULT_RPC_URL,
  NATIVE_ASSET,
  SHIELDSCORE_ADDRESS,
  SHIELDSCORE_CHAIN_ID,
  shieldScoreAbi,
  type CreditProfile,
  type LendingPool,
  type Loan,
} from "@/lib/shieldscore-contract";
import type { IndexedProtocolData } from "@/lib/shieldscore-indexer";

export const runtime = "nodejs";

type CreditAuthorizationRequest = {
  account?: string;
  refresh?: boolean;
};

const emptyIndex: IndexedProtocolData = {
  events: [],
  scoreHistory: [],
  poolTimeline: [],
  repaymentEvents: [],
  defaultEvents: [],
  utilizationHistory: [],
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

const sepoliaChain = defineChain({
  id: 11155111,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] },
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
  testnet: true,
});

const arbitrumSepoliaChain = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Arbitrum Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
  },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
  },
  testnet: true,
});

function normalizePrivateKey(key?: string): Hex | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to authorize credit snapshot";
}

function rateLimitKey(request: Request, account: Address) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${ip}:${account.toLowerCase()}`;
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

function isDeploymentMismatch(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("returned no data") ||
    message.includes("cannot decode") ||
    message.includes("function selector") ||
    message.includes("function does not exist") ||
    message.includes("contract function") ||
    message.includes("abi")
  );
}

function chainForId(chainId: number) {
  if (chainId === 421614) return arbitrumSepoliaChain;
  return sepoliaChain;
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

function poolFromTuple(id: number, tuple: readonly unknown[]): LendingPool {
  const totalBorrowed = tuple[11] as bigint;
  const totalRepaid = tuple[12] as bigint;
  const defaultedPrincipal = tuple[14] as bigint;
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
    totalBorrowed,
    totalRepaid,
    interestEarned: tuple[13] as bigint,
    defaultedPrincipal,
    recoveredCollateral: tuple[15] as bigint,
    borrowerScoreTotal: tuple[16] as bigint,
    loanCount: Number(tuple[17]),
    defaultCount: Number(tuple[18]),
    active: Boolean(tuple[19]),
    utilizationBps: 0,
    averageScore: 0,
    defaultRateBps: 0,
    expectedYieldBps: 0,
    activePrincipal: totalBorrowed - totalRepaid - defaultedPrincipal,
  };
}

async function readCreditState(client: ReturnType<typeof createPublicClient>, account: Address) {
  const [profileTuple, loanIds, poolCount] = await Promise.all([
    client.readContract({
      address: SHIELDSCORE_ADDRESS!,
      abi: shieldScoreAbi,
      functionName: "profiles",
      args: [account],
    }),
    client.readContract({
      address: SHIELDSCORE_ADDRESS!,
      abi: shieldScoreAbi,
      functionName: "borrowerLoanIds",
      args: [account],
    }),
    client.readContract({
      address: SHIELDSCORE_ADDRESS!,
      abi: shieldScoreAbi,
      functionName: "poolCount",
    }),
  ]);

  const loans = await Promise.all(
    (loanIds as bigint[]).map(async (loanId) => {
      const tuple = await client.readContract({
        address: SHIELDSCORE_ADDRESS!,
        abi: shieldScoreAbi,
        functionName: "loans",
        args: [loanId],
      });
      return loanFromTuple(Number(loanId), tuple as readonly unknown[]);
    })
  );

  const relevantPoolIds = new Set<number>([
    ...loans.map((loan) => loan.poolId),
    ...Array.from({ length: Math.min(Number(poolCount), 25) }, (_, index) => index + 1),
  ]);
  const pools = await Promise.all(
    Array.from(relevantPoolIds).map(async (poolId) => {
      const tuple = await client.readContract({
        address: SHIELDSCORE_ADDRESS!,
        abi: shieldScoreAbi,
        functionName: "pools",
        args: [BigInt(poolId)],
      });
      return poolFromTuple(poolId, tuple as readonly unknown[]);
    })
  );

  return { profile: profileFromTuple(profileTuple as readonly unknown[]), loans, pools };
}

async function encryptServerSignals(
  account: Address,
  signals: Awaited<ReturnType<typeof ingestWalletCreditSignals>>["signals"],
  client: ReturnType<typeof createPublicClient>,
  signer: ReturnType<typeof privateKeyToAccount>
) {
  const [{ createCofheClient, createCofheConfig }, { Encryptable }, cofheChains] = await Promise.all([
    import("@cofhe/sdk/node"),
    import("@cofhe/sdk"),
    import("@cofhe/sdk/chains"),
  ]);
  const cofheChain = cofheChains.getChainById(SHIELDSCORE_CHAIN_ID);
  if (!cofheChain) throw new Error("Configured chain is not supported by CoFHE");

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [cofheChain], fheKeyStorage: null }));
  const walletClient = createWalletClient({
    account: signer,
    chain: chainForId(SHIELDSCORE_CHAIN_ID),
    transport: http(DEFAULT_RPC_URL),
  });
  await cofhe.connect(client as any, walletClient as any);
  return cofhe
    .encryptInputs([
      Encryptable.uint32(BigInt(signals.balanceConsistency)),
      Encryptable.uint32(BigInt(signals.repaymentHistory)),
      Encryptable.uint32(BigInt(signals.walletAge)),
      Encryptable.uint32(BigInt(signals.protocolDiversity)),
      Encryptable.uint32(BigInt(signals.incomeConsistency)),
    ])
    .setAccount(account)
    .setChainId(SHIELDSCORE_CHAIN_ID)
    .execute() as Promise<EncryptedInputLike[]>;
}

function serializeEncryptedInput(input: EncryptedInputLike) {
  return {
    ctHash: input.ctHash.toString(),
    securityZone: input.securityZone,
    utype: input.utype,
    signature: input.signature,
  };
}

export async function POST(request: Request) {
  try {
    if (!SHIELDSCORE_ADDRESS) {
      return NextResponse.json({ error: "ShieldScore contract is not configured" }, { status: 503 });
    }

    const attesterKey = normalizePrivateKey(process.env.CREDIT_ATTESTER_PRIVATE_KEY);
    if (!attesterKey) {
      return NextResponse.json({ error: "Credit attester key is not configured" }, { status: 503 });
    }

    const body = (await request.json()) as CreditAuthorizationRequest;
    if (!body.account || !isAddress(body.account)) {
      return NextResponse.json({ error: "Account is invalid" }, { status: 400 });
    }
    const account = getAddress(body.account) as Address;
    if (!consumeRateLimit(rateLimitKey(request, account))) {
      return NextResponse.json({ error: "Too many credit authorization requests. Try again shortly." }, { status: 429 });
    }
    const signer = privateKeyToAccount(attesterKey);
    const client = createPublicClient({
      chain: chainForId(SHIELDSCORE_CHAIN_ID),
      transport: http(DEFAULT_RPC_URL),
    });
    const [nonce, configuredAttester] = await Promise.all([
      client.readContract({
        address: SHIELDSCORE_ADDRESS,
        abi: shieldScoreAbi,
        functionName: "scoreNonces",
        args: [account],
      }),
      client.readContract({
        address: SHIELDSCORE_ADDRESS,
        abi: shieldScoreAbi,
        functionName: "creditAttester",
      }),
    ]);

    if (getAddress(configuredAttester) !== signer.address) {
      return NextResponse.json({ error: "Credit attester key does not match the contract" }, { status: 503 });
    }

    const { profile, loans, pools } = await readCreditState(client, account);
    const { signals, trends } = await ingestWalletCreditSignals({
      client,
      account,
      profile,
      loans,
      pools: pools.filter((pool) => pool.asset.toLowerCase() !== NATIVE_ASSET || pool.active || pool.loanCount > 0),
      index: emptyIndex,
    });
    const inputs = await encryptServerSignals(account, signals, client, signer);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
    const inputsHash = creditInputsHash(inputs);
    const signature = await signer.signTypedData({
      domain: creditAuthorizationDomain({
        chainId: SHIELDSCORE_CHAIN_ID,
        verifyingContract: SHIELDSCORE_ADDRESS,
      }),
      types: CREDIT_AUTHORIZATION_TYPES,
      primaryType: "CreditAuthorization",
      message: {
        account,
        inputsHash,
        refresh: Boolean(body.refresh),
        nonce,
        deadline,
      },
    });

    return NextResponse.json({
      authorization: {
        nonce: nonce.toString(),
        deadline: Number(deadline),
        signature,
      },
      inputs: inputs.map(serializeEncryptedInput),
      signals,
      trends,
      inputsHash,
    });
  } catch (error) {
    if (isDeploymentMismatch(error)) {
      return NextResponse.json(
        {
          error:
            "Configured ShieldScore deployment does not match the current Wave 5 contract ABI. Redeploy the contracts and update NEXT_PUBLIC_SHIELDSCORE_ADDRESS.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
