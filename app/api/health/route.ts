import { NextResponse } from "next/server";
import { createPublicClient, defineChain, getAddress, http, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_RPC_URL,
  SHIELDSCORE_ADDRESS,
  SHIELDSCORE_CHAIN_ID,
  SHIELDSCORE_START_BLOCK,
  SHIELDSCORE_USDC_ADDRESS,
  shieldScoreAbi,
} from "@/lib/shieldscore-contract";

export const runtime = "nodejs";

type CheckStatus = "ok" | "warn" | "fail";

type HealthCheck = {
  name: string;
  status: CheckStatus;
  detail?: string;
};

function normalizePrivateKey(key?: string): Hex | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

function chainForId(chainId: number) {
  if (chainId === 421614) {
    return defineChain({
      id: 421614,
      name: "Arbitrum Sepolia",
      nativeCurrency: { name: "Arbitrum Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
      testnet: true,
    });
  }

  return defineChain({
    id: 11155111,
    name: "Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } },
    testnet: true,
  });
}

function pushCheck(checks: HealthCheck[], name: string, status: CheckStatus, detail?: string) {
  checks.push({ name, status, detail });
}

export async function GET() {
  const checks: HealthCheck[] = [];
  const attesterKey = normalizePrivateKey(process.env.CREDIT_ATTESTER_PRIVATE_KEY);
  let attesterAddress: Address | undefined;
  let attesterKeyValid = true;
  if (attesterKey) {
    try {
      attesterAddress = privateKeyToAccount(attesterKey).address;
    } catch {
      attesterKeyValid = false;
    }
  }
  const contractAddress = SHIELDSCORE_ADDRESS && isAddress(SHIELDSCORE_ADDRESS) ? getAddress(SHIELDSCORE_ADDRESS) : undefined;
  const usdcAddress =
    SHIELDSCORE_USDC_ADDRESS && isAddress(SHIELDSCORE_USDC_ADDRESS) ? getAddress(SHIELDSCORE_USDC_ADDRESS) : undefined;

  if (contractAddress) {
    pushCheck(checks, "contract-env", "ok", contractAddress);
  } else {
    pushCheck(checks, "contract-env", "fail", "NEXT_PUBLIC_SHIELDSCORE_ADDRESS is missing or invalid");
  }

  if (DEFAULT_RPC_URL) {
    pushCheck(checks, "rpc-env", "ok", "NEXT_PUBLIC_DEFAULT_RPC_URL configured");
  } else {
    pushCheck(checks, "rpc-env", "fail", "NEXT_PUBLIC_DEFAULT_RPC_URL is missing");
  }

  if (attesterKey && attesterKeyValid) {
    pushCheck(checks, "attester-env", "ok", "Server-side credit attester key is configured");
  } else if (attesterKey) {
    pushCheck(checks, "attester-env", "fail", "Server-side credit attester key is invalid");
  } else {
    pushCheck(checks, "attester-env", "warn", "CREDIT_ATTESTER_PRIVATE_KEY is not configured");
  }

  const client = createPublicClient({
    chain: chainForId(SHIELDSCORE_CHAIN_ID),
    transport: http(DEFAULT_RPC_URL),
  });

  let blockNumber: bigint | undefined;
  let protocolCodeBytes = 0;
  let usdcCodeBytes = 0;
  let poolCount: bigint | undefined;
  let creditAttester: Address | undefined;
  let wave5AbiCompatible = false;
  let usdcPolicyApproved = false;
  let usdcPolicyPrice: bigint | undefined;

  try {
    blockNumber = await client.getBlockNumber();
    pushCheck(checks, "rpc-connectivity", "ok", `Latest block ${blockNumber.toString()}`);
  } catch (error) {
    pushCheck(checks, "rpc-connectivity", "fail", error instanceof Error ? error.message : "Unable to reach RPC");
  }

  if (contractAddress) {
    try {
      const code = await client.getBytecode({ address: contractAddress });
      protocolCodeBytes = code ? (code.length - 2) / 2 : 0;
      pushCheck(
        checks,
        "contract-code",
        protocolCodeBytes > 0 ? "ok" : "fail",
        protocolCodeBytes > 0 ? `${protocolCodeBytes} bytes deployed` : "No bytecode at configured address"
      );
    } catch (error) {
      pushCheck(checks, "contract-code", "fail", error instanceof Error ? error.message : "Unable to read bytecode");
    }

    try {
      const [nonce, attester, pools] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: shieldScoreAbi,
          functionName: "scoreNonces",
          args: [zeroAddress],
        }),
        client.readContract({
          address: contractAddress,
          abi: shieldScoreAbi,
          functionName: "creditAttester",
        }),
        client.readContract({
          address: contractAddress,
          abi: shieldScoreAbi,
          functionName: "poolCount",
        }),
      ]);
      void nonce;
      creditAttester = getAddress(attester);
      poolCount = pools;
      wave5AbiCompatible = true;
      pushCheck(checks, "wave5-abi", "ok", "scoreNonces, creditAttester, and poolCount are readable");
    } catch (error) {
      pushCheck(
        checks,
        "wave5-abi",
        "fail",
        error instanceof Error ? error.message : "Configured contract does not expose the Wave 5 ABI"
      );
    }
  }

  if (creditAttester && attesterAddress) {
    pushCheck(
      checks,
      "attester-match",
      getAddress(attesterAddress) === creditAttester ? "ok" : "fail",
      getAddress(attesterAddress) === creditAttester
        ? "Configured server signer matches contract creditAttester"
        : "Configured server signer does not match contract creditAttester"
    );
  } else if (wave5AbiCompatible) {
    pushCheck(checks, "attester-match", "warn", "Cannot compare attester until CREDIT_ATTESTER_PRIVATE_KEY is configured");
  }

  if (usdcAddress) {
    try {
      const code = await client.getBytecode({ address: usdcAddress });
      usdcCodeBytes = code ? (code.length - 2) / 2 : 0;
      pushCheck(
        checks,
        "usdc-code",
        usdcCodeBytes > 0 ? "ok" : "warn",
        usdcCodeBytes > 0 ? `${usdcCodeBytes} bytes deployed` : "No bytecode at configured ssUSDC address"
      );
    } catch (error) {
      pushCheck(checks, "usdc-code", "warn", error instanceof Error ? error.message : "Unable to read ssUSDC bytecode");
    }

    if (contractAddress && wave5AbiCompatible) {
      try {
        const policy = await client.readContract({
          address: contractAddress,
          abi: shieldScoreAbi,
          functionName: "assetPolicies",
          args: [usdcAddress],
        });
        const approved = Boolean(policy[0]);
        const price = policy[1] as bigint;
        usdcPolicyApproved = approved;
        usdcPolicyPrice = price;
        pushCheck(
          checks,
          "usdc-policy",
          approved && price > 0n ? "ok" : "fail",
          approved && price > 0n
            ? `Approved at ${price.toString()} wei per token`
            : "Configured ssUSDC is not approved for ERC-20 pools"
        );
      } catch (error) {
        pushCheck(checks, "usdc-policy", "fail", error instanceof Error ? error.message : "Unable to read ssUSDC policy");
      }
    }
  } else {
    pushCheck(checks, "usdc-env", "warn", "NEXT_PUBLIC_SHIELDSCORE_USDC_ADDRESS is not configured");
  }

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasWarning = checks.some((check) => check.status === "warn");
  const status = hasFailure ? "degraded" : hasWarning ? "attention" : "ok";

  return NextResponse.json(
    {
      service: "shieldscore",
      status,
      timestamp: new Date().toISOString(),
      chainId: SHIELDSCORE_CHAIN_ID,
      startBlock: SHIELDSCORE_START_BLOCK?.toString(),
      blockNumber: blockNumber?.toString(),
      contract: {
        address: contractAddress,
        codeBytes: protocolCodeBytes,
        wave5AbiCompatible,
        poolCount: poolCount?.toString(),
      },
      usdc: {
        address: usdcAddress,
        codeBytes: usdcCodeBytes,
        policyApproved: usdcPolicyApproved,
        policyCollateralPriceWei: usdcPolicyPrice?.toString(),
      },
      attester: {
        keyConfigured: Boolean(attesterKey),
        contractAddress: creditAttester,
        keyMatchesContract: Boolean(creditAttester && attesterAddress && getAddress(attesterAddress) === creditAttester),
      },
      checks,
    },
    { status: hasFailure ? 503 : 200 }
  );
}
