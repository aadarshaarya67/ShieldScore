import { formatEther, type Address, type PublicClient } from "viem";
import { NATIVE_ASSET, type CreditProfile, type LendingPool, type Loan } from "./shieldscore-contract";
import type { IndexedProtocolData } from "./shieldscore-indexer";

export type CreditSignalSet = {
  balanceConsistency: number;
  repaymentHistory: number;
  walletAge: number;
  protocolDiversity: number;
  incomeConsistency: number;
};

export type CreditSignalTrend = {
  key: keyof CreditSignalSet;
  label: string;
  value: number;
  previous: number;
};

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysBetween(start: number, end: number) {
  return Math.max(0, (end - start) / 86_400);
}

export async function ingestWalletCreditSignals({
  client,
  account,
  profile,
  loans,
  pools = [],
  index,
}: {
  client: PublicClient;
  account: Address;
  profile: CreditProfile;
  loans: Loan[];
  pools?: LendingPool[];
  index: IndexedProtocolData;
}): Promise<{ signals: CreditSignalSet; trends: CreditSignalTrend[] }> {
  const [balance, txCount] = await Promise.all([
    client.getBalance({ address: account }),
    client.getTransactionCount({ address: account }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const firstProtocolTouch = Math.min(
    ...[
      profile.encryptedUpdatedAt,
      profile.scorePublishedAt,
      ...index.events.map((event) => event.timestamp),
      now,
    ].filter(Boolean)
  );
  const walletAgeDays = Math.max(daysBetween(firstProtocolTouch, now), Math.min(txCount * 3, 365));
  const activeLoans = loans.filter((loan) => loan.status === 0);
  const onTimeRepayments = Math.max(profile.loansRepaid, index.repaymentEvents.length);
  const defaults = Math.max(profile.loansDefaulted, index.defaultEvents.length);
  const lateRepayments = profile.loansRepaidLate;
  const uniquePools = new Set(loans.map((loan) => loan.poolId));
  const balanceEth = Number(formatEther(balance));
  const activeDebtWei = activeLoans.reduce((sum, loan) => {
    const pool = pools.find((item) => item.id === loan.poolId);
    if (!pool || pool.asset.toLowerCase() === NATIVE_ASSET) return sum + loan.principal;
    return sum + (loan.principal * pool.collateralPriceWei) / 10n ** BigInt(pool.assetDecimals);
  }, 0n);
  const activeDebt = Number(formatEther(activeDebtWei));
  const debtPressure = activeDebt > 0 ? Math.min(35, activeDebt / Math.max(balanceEth, 0.01)) : 0;

  const signals: CreditSignalSet = {
    balanceConsistency: clampScore(58 + Math.min(balanceEth * 50, 28) + Math.min(txCount, 20) - debtPressure),
    repaymentHistory: clampScore(55 + onTimeRepayments * 12 + lateRepayments * 4 - defaults * 32),
    walletAge: clampScore(35 + Math.min(walletAgeDays / 3.65, 45) + Math.min(txCount, 20)),
    protocolDiversity: clampScore(45 + uniquePools.size * 18 + Math.min(index.events.length, 20)),
    incomeConsistency: clampScore(52 + Math.min(balanceEth * 40, 22) + onTimeRepayments * 5 - activeLoans.length * 7),
  };

  const previous: CreditSignalSet = {
    balanceConsistency: clampScore(signals.balanceConsistency - 4),
    repaymentHistory: clampScore(signals.repaymentHistory - onTimeRepayments * 3 + defaults * 6),
    walletAge: clampScore(signals.walletAge - 2),
    protocolDiversity: clampScore(signals.protocolDiversity - uniquePools.size * 2),
    incomeConsistency: clampScore(signals.incomeConsistency - 3),
  };

  const labels: Record<keyof CreditSignalSet, string> = {
    balanceConsistency: "Balance consistency",
    repaymentHistory: "Repayment history",
    walletAge: "Wallet age",
    protocolDiversity: "Protocol diversity",
    incomeConsistency: "Income consistency",
  };

  return {
    signals,
    trends: (Object.keys(signals) as (keyof CreditSignalSet)[]).map((key) => ({
      key,
      label: labels[key],
      value: signals[key],
      previous: previous[key],
    })),
  };
}
