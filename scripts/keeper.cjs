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
  const [keeper] = await hre.ethers.getSigners();
  const latestBlock = await hre.ethers.provider.getBlock("latest");
  const totalLoans = await protocol.loanCount();

  console.log(`Keeper ${keeper.address} scanning ${totalLoans} loans on ${hre.network.name}`);
  console.log(`Protocol: ${deployment.address}`);

  let marked = 0;
  for (let id = 1n; id <= totalLoans; id += 1n) {
    const loan = await protocol.loans(id);
    const status = Number(loan.status);
    const dueTime = Number(loan.dueTime);

    if (status !== 0 || latestBlock.timestamp <= dueTime) continue;

    const tx = await protocol.markDefault(id);
    await tx.wait();
    marked += 1;
    console.log(`Marked loan ${id.toString()} defaulted`);
  }

  if (marked === 0) {
    console.log("No overdue active loans found");
  } else {
    console.log(`Marked ${marked} overdue loans`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


