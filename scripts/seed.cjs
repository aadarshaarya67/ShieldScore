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
  const [deployer] = await hre.ethers.getSigners();
  const existingPools = await protocol.poolCount();

  console.log(`Seeding ShieldScoreProtocol ${deployment.address} on ${hre.network.name}`);
  console.log(`Seeder: ${deployer.address}`);

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
      maxLoan: "0.01",
      liquidity: "0.03",
    },
    {
      minScore: 720,
      collateralBps: 2500,
      interestBps: 900,
      duration: 45 * 24 * 60 * 60,
      maxLoan: "0.008",
      liquidity: "0.02",
    },
    {
      minScore: 800,
      collateralBps: 1200,
      interestBps: 650,
      duration: 60 * 24 * 60 * 60,
      maxLoan: "0.005",
      liquidity: "0.015",
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
