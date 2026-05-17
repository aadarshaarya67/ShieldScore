const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`Deploying ShieldScoreProtocol from ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);

  const factory = await hre.ethers.getContractFactory("ShieldScoreProtocol");
  const protocol = await factory.deploy();
  await protocol.waitForDeployment();

  const address = await protocol.getAddress();
  const deployment = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    address,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const outDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${hre.network.name}.json`), `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`ShieldScoreProtocol deployed to ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
