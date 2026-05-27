const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`Deploying ShieldScoreProtocol from ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH`);

  let usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    const tokenFactory = await hre.ethers.getContractFactory("ShieldScoreUSDC");
    const usdc = await tokenFactory.deploy(deployer.address);
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log(`ShieldScoreUSDC deployed to ${usdcAddress}`);
  } else {
    console.log(`Using existing USDC test token at ${usdcAddress}`);
  }

  const factory = await hre.ethers.getContractFactory("ShieldScoreProtocol");
  const protocol = await factory.deploy();
  await protocol.waitForDeployment();

  const address = await protocol.getAddress();
  let creditAttester = await protocol.creditAttester();
  const creditAttesterKey = process.env.CREDIT_ATTESTER_PRIVATE_KEY;
  if (creditAttesterKey) {
    const normalizedKey = creditAttesterKey.trim().startsWith("0x")
      ? creditAttesterKey.trim()
      : `0x${creditAttesterKey.trim()}`;
    const nextCreditAttester = new hre.ethers.Wallet(normalizedKey).address;
    if (nextCreditAttester.toLowerCase() !== creditAttester.toLowerCase()) {
      const tx = await protocol.setCreditAttester(nextCreditAttester);
      await tx.wait();
      creditAttester = nextCreditAttester;
    }
  }
  const usdcCollateralPriceEth = process.env.USDC_COLLATERAL_PRICE_ETH || "0.0005";
  const policyTx = await protocol.setAssetPolicy(usdcAddress, true, hre.ethers.parseEther(usdcCollateralPriceEth));
  await policyTx.wait();

  const deployTx = protocol.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : undefined;
  const deployment = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    address,
    usdcAddress,
    blockNumber: receipt ? Number(receipt.blockNumber) : undefined,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    creditAttester,
    usdcCollateralPriceEth,
  };

  const outDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${hre.network.name}.json`), `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`ShieldScoreProtocol deployed to ${address}`);
  console.log(`Credit attester: ${creditAttester}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
