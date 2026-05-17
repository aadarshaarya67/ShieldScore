const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { Encryptable } = require("@cofhe/sdk");

async function publishBorrowerScore(protocol, borrower, values) {
  const client = await hre.cofhe.createClientWithBatteries(borrower);
  const encrypted = await client
    .encryptInputs(values.map((value) => Encryptable.uint32(BigInt(value))))
    .execute();

  await protocol
    .connect(borrower)
    .submitEncryptedSnapshot(encrypted[0], encrypted[1], encrypted[2], encrypted[3], encrypted[4]);

  const handle = await protocol.encryptedScoreOf(borrower.address);
  const clear = await client.decryptForTx(handle).withoutPermit().execute();

  await protocol.connect(borrower).publishScore(Number(clear.decryptedValue), clear.signature);
  return Number(clear.decryptedValue);
}

async function expectCustomError(promise, errorName) {
  try {
    await promise;
  } catch (error) {
    expect(error.message).to.include(errorName);
    return;
  }
  throw new Error(`Expected custom error ${errorName}`);
}

describe("ShieldScoreProtocol", function () {
  async function deployFixture() {
    const [lender, borrower, other] = await ethers.getSigners();
    const protocol = await ethers.deployContract("ShieldScoreProtocol");
    await protocol.waitForDeployment();
    return { protocol, lender, borrower, other };
  }

  it("computes an encrypted score, verifies decrypt-for-tx, and publishes only the final score", async function () {
    const { protocol, borrower } = await deployFixture();

    const score = await publishBorrowerScore(protocol, borrower, [80, 90, 70, 80, 75]);
    const profile = await protocol.profiles(borrower.address);

    expect(score).to.equal(744);
    expect(profile.publicScore).to.equal(744n);
    expect(profile.snapshotsSubmitted).to.equal(1n);
  });

  it("runs the lender pool, borrow, repay, and attestation flow end to end", async function () {
    const { protocol, lender, borrower } = await deployFixture();
    await publishBorrowerScore(protocol, borrower, [80, 90, 70, 80, 75]);

    await protocol
      .connect(lender)
      .createPool(650, 4_000, 1_200, 30 * 24 * 60 * 60, ethers.parseEther("1"), {
        value: ethers.parseEther("5"),
      });

    await expectCustomError(
      protocol.connect(borrower).fundPool(1, {
        value: ethers.parseEther("0.1"),
      }),
      "NotPoolLender"
    );

    await protocol.connect(lender).fundPool(1, {
      value: ethers.parseEther("0.25"),
    });

    const principal = ethers.parseEther("1");
    const collateral = (principal * 2_500n) / 10_000n;

    await protocol.connect(borrower).borrow(1, principal, { value: collateral });

    const loan = await protocol.loans(1);
    expect(loan.principal).to.equal(principal);
    expect(loan.collateral).to.equal(collateral);

    const due = loan.principal + loan.interest;
    await protocol.connect(borrower).repay(1, { value: due });

    const repaidLoan = await protocol.loans(1);
    const profile = await protocol.profiles(borrower.address);
    expect(repaidLoan.status).to.equal(1n);
    expect(profile.loansRepaid).to.equal(1n);

    const tx = await protocol.connect(borrower).issueScoreAttestation(700);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return protocol.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log && log.name === "ScoreAttestationIssued");

    expect(event).to.not.equal(undefined);
    const attestationId = event.args.attestationId;
    expect(await protocol.verifyAttestation(attestationId, borrower.address, 700)).to.equal(true);
    await expectCustomError(protocol.connect(borrower).issueScoreAttestation(851), "InvalidScore");
  });

  it("moves overdue active loans into default and credits collateral to pool liquidity", async function () {
    const { protocol, lender, borrower } = await deployFixture();
    await publishBorrowerScore(protocol, borrower, [75, 75, 70, 70, 80]);

    await protocol.connect(lender).createPool(650, 5_000, 1_000, 7 * 24 * 60 * 60, ethers.parseEther("0.5"), {
      value: ethers.parseEther("2"),
    });

    const principal = ethers.parseEther("0.5");
    const collateral = (principal * 5_000n) / 10_000n;
    await protocol.connect(borrower).borrow(1, principal, { value: collateral });

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    await protocol.markDefault(1);
    const loan = await protocol.loans(1);
    const pool = await protocol.pools(1);

    expect(loan.status).to.equal(2n);
    expect(pool.defaultCount).to.equal(1n);
    expect(pool.defaultedPrincipal).to.equal(principal);
  });
});
