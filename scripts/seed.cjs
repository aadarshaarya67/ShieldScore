const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const deploymentPath = path.join(process.cwd(), "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Missing deployment file for ${hre.network.name}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const protocol = await hre.ethers.getContractAt("ShieldScoreProtocol", deployment.address);
  const usdcAddress = process.env.USDC_ADDRESS || deployment.usdcAddress;
  const usdc = usdcAddress ? await hre.ethers.getContractAt("ShieldScoreUSDC", usdcAddress) : undefined;
  const [deployer] = await hre.ethers.getSigners();
  const existingPools = await protocol.poolCount();
  const usdcCollateralPriceEth = process.env.USDC_COLLATERAL_PRICE_ETH || deployment.usdcCollateralPriceEth || "0.0005";

  console.log(`Seeding ShieldScoreProtocol ${deployment.address} on ${hre.network.name}`);
  console.log(`Seeder: ${deployer.address}`);
  if (usdcAddress) console.log(`USDC test token: ${usdcAddress}`);
  if (usdcAddress) {
    const expectedPrice = hre.ethers.parseEther(usdcCollateralPriceEth);
    const policy = await protocol.assetPolicies(usdcAddress);
    if (!policy.approved || policy.collateralPriceWei !== expectedPrice) {
      const policyTx = await protocol.setAssetPolicy(usdcAddress, true, expectedPrice);
      await policyTx.wait();
      console.log(`Approved ssUSDC collateral price=${usdcCollateralPriceEth} ETH`);
    }
  }

  if (existingPools > 0n) {
    console.log(`Skipped: ${existingPools} pools already exist`);
    return;
  }

  const pools = [
    {
      minScore: 650,
      collateralBps: 4000,
      interestBps: 1200,
      duration: 30 * 24 * 60 * 60,
      maxLoan: "0.001",
      liquidity: "0.003",
    },
    {
      minScore: 720,
      collateralBps: 2500,
      interestBps: 900,
      duration: 45 * 24 * 60 * 60,
      maxLoan: "0.0008",
      liquidity: "0.002",
    },
    {
      minScore: 800,
      collateralBps: 1200,
      interestBps: 650,
      duration: 60 * 24 * 60 * 60,
      maxLoan: "0.0005",
      liquidity: "0.0015",
    },
  ];

  for (const pool of pools) {
    const tx = await protocol.createPool(
      pool.minScore,
      pool.collateralBps,
      pool.interestBps,
      pool.duration,
      hre.ethers.parseEther(pool.maxLoan),
      { value: hre.ethers.parseEther(pool.liquidity) }
    );
    await tx.wait();
    console.log(`Created pool minScore=${pool.minScore} liquidity=${pool.liquidity} ETH`);
  }

  if (!usdc) {
    console.log("Skipped ERC-20 pools: missing usdcAddress in deployment");
    return;
  }

  const tokenPools = [
    {
      minScore: 680,
      collateralBps: 3500,
      interestBps: 950,
      duration: 30 * 24 * 60 * 60,
      maxLoan: "250",
      liquidity: "2500",
      collateralPriceEth: usdcCollateralPriceEth,
    },
    {
      minScore: 760,
      collateralBps: 1800,
      interestBps: 700,
      duration: 60 * 24 * 60 * 60,
      maxLoan: "150",
      liquidity: "1800",
      collateralPriceEth: usdcCollateralPriceEth,
    },
  ];

  for (const pool of tokenPools) {
    const liquidity = hre.ethers.parseUnits(pool.liquidity, 6);
    const maxLoan = hre.ethers.parseUnits(pool.maxLoan, 6);
    const allowance = await usdc.allowance(deployer.address, deployment.address);
    if (allowance < liquidity) {
      const approveTx = await usdc.approve(deployment.address, liquidity);
      await approveTx.wait();
    }
    const tx = await protocol.createErc20Pool(
      usdcAddress,
      hre.ethers.parseEther(pool.collateralPriceEth),
      pool.minScore,
      pool.collateralBps,
      pool.interestBps,
      pool.duration,
      maxLoan,
      liquidity
    );
    await tx.wait();
    console.log(`Created ssUSDC pool minScore=${pool.minScore} liquidity=${pool.liquidity}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
