const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { Encryptable } = require("@cofhe/sdk");

const CREDIT_AUTHORIZATION_TYPES = {
  CreditAuthorization: [
    { name: "account", type: "address" },
    { name: "inputsHash", type: "bytes32" },
    { name: "refresh", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

function encryptedInputHash(input) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint8", "uint8", "bytes32"],
      [input.ctHash, input.securityZone, input.utype, ethers.keccak256(input.signature)]
    )
  );
}

function encryptedInputsHash(inputs) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      inputs.map(encryptedInputHash)
    )
  );
}

async function authorizeScoreSnapshot(protocol, attester, account, encrypted, refresh = false, deadlineOffset = 3600) {
  const nonce = await protocol.scoreNonces(account);
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock.timestamp + deadlineOffset);
  const { chainId } = await ethers.provider.getNetwork();
  const signature = await attester.signTypedData(
    {
      name: "ShieldScoreProtocol",
      version: "1",
      chainId,
      verifyingContract: await protocol.getAddress(),
    },
    CREDIT_AUTHORIZATION_TYPES,
    {
      account,
      inputsHash: encryptedInputsHash(encrypted),
      refresh,
      nonce,
      deadline,
    }
  );
  return { nonce, deadline, signature };
}

async function submitAndPublishScore(protocol, borrower, attester, values, refresh = false) {
  const client = await hre.cofhe.createClientWithBatteries(borrower);
  const encrypted = await client
    .encryptInputs(values.map((value) => Encryptable.uint32(BigInt(value))))
    .execute();
  const authorization = await authorizeScoreSnapshot(protocol, attester, borrower.address, encrypted, refresh);

  if (refresh) {
    await protocol
      .connect(borrower)
      .submitEncryptedRefreshSnapshot(encrypted[0], encrypted[1], encrypted[2], encrypted[3], encrypted[4], authorization);
  } else {
    await protocol
      .connect(borrower)
      .submitEncryptedSnapshot(encrypted[0], encrypted[1], encrypted[2], encrypted[3], encrypted[4], authorization);
  }

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
    const [lender, borrower, other, guardian] = await ethers.getSigners();
    const protocol = await ethers.deployContract("ShieldScoreProtocol");
    await protocol.waitForDeployment();

    const usdc = await ethers.deployContract("ShieldScoreUSDC", [lender.address]);
    await usdc.waitForDeployment();
    await protocol.setAssetPolicy(await usdc.getAddress(), true, ethers.parseEther("0.0005"));

    return { protocol, usdc, lender, borrower, other, guardian };
  }

  it("computes an encrypted score, verifies decrypt-for-tx, and records score history", async function () {
    const { protocol, lender, borrower } = await deployFixture();

    const score = await submitAndPublishScore(protocol, borrower, lender, [80, 90, 70, 80, 75]);
    const profile = await protocol.profiles(borrower.address);
    const history = await protocol.scoreHistoryOf(borrower.address);

    expect(score).to.equal(744);
    expect(profile.publicScore).to.equal(744n);
    expect(profile.snapshotsSubmitted).to.equal(1n);
    expect(history.length).to.equal(1);
    expect(history[0].score).to.equal(744n);
    expect(history[0].refresh).to.equal(false);
    expect(await protocol.scoreNonces(borrower.address)).to.equal(1n);
    await expectCustomError(protocol.connect(borrower).publishScore(score, "0x"), "MissingEncryptedScore");
  });

  it("runs the native pool, borrow, repay, refresh, and attestation flow end to end", async function () {
    const { protocol, lender, borrower } = await deployFixture();
    await submitAndPublishScore(protocol, borrower, lender, [80, 90, 70, 80, 75]);

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
    expect(await protocol.scoreRefreshAdjustment(borrower.address)).to.equal(8n);

    await expectCustomError(protocol.connect(borrower).borrow(1, ethers.parseEther("0.1"), { value: ethers.parseEther("0.025") }), "ScoreStale");
    await expectCustomError(protocol.connect(borrower).issueScoreAttestation(700), "ScoreStale");

    const refreshedScore = await submitAndPublishScore(protocol, borrower, lender, [80, 90, 70, 80, 75], true);
    const history = await protocol.scoreHistoryOf(borrower.address);
    expect(refreshedScore).to.equal(752);
    expect(history.length).to.equal(2);
    expect(history[1].refresh).to.equal(true);
    expect(history[1].activityAdjustment).to.equal(8n);

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
    await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    expect(await protocol.verifyAttestation(attestationId, borrower.address, 700)).to.equal(false);
    await protocol.connect(borrower).revokeAttestation(attestationId);
    expect(await protocol.verifyAttestation(attestationId, borrower.address, 700)).to.equal(false);
    await expectCustomError(protocol.connect(borrower).issueScoreAttestation(851), "InvalidScore");
  });

  it("supports ERC-20 USDC-style lending pools with approvals, token repayment, and recovered ETH collateral", async function () {
    const { protocol, usdc, lender, borrower } = await deployFixture();
    await submitAndPublishScore(protocol, borrower, lender, [85, 90, 70, 85, 80]);

    const protocolAddress = await protocol.getAddress();
    const usdcAddress = await usdc.getAddress();
    const initialLiquidity = ethers.parseUnits("5000", 6);
    const maxLoan = ethers.parseUnits("1000", 6);
    const collateralPriceWei = ethers.parseEther("0.0005");

    await usdc.connect(lender).approve(protocolAddress, initialLiquidity);
    await protocol
      .connect(lender)
      .createErc20Pool(usdcAddress, collateralPriceWei, 700, 2_500, 900, 45 * 24 * 60 * 60, maxLoan, initialLiquidity);

    const principal = ethers.parseUnits("100", 6);
    const requiredCollateral = await protocol.requiredCollateralFor(1, principal, 760);
    await protocol.connect(borrower).borrow(1, principal, { value: requiredCollateral });

    expect(await usdc.balanceOf(borrower.address)).to.equal(principal);

    const loan = await protocol.loans(1);
    const due = loan.principal + loan.interest;
    await usdc.connect(lender).transfer(borrower.address, ethers.parseUnits("5", 6));
    await usdc.connect(borrower).approve(protocolAddress, due);
    await protocol.connect(borrower).repay(1);

    const repaidLoan = await protocol.loans(1);
    const pool = await protocol.pools(1);
    expect(repaidLoan.status).to.equal(1n);
    expect(pool.liquidity).to.equal(initialLiquidity + loan.interest);
  });

  it("rejects ERC-20 pools for assets that are not owner-approved", async function () {
    const { protocol, lender } = await deployFixture();
    const unapproved = await ethers.deployContract("ShieldScoreUSDC", [lender.address]);
    await unapproved.waitForDeployment();

    await unapproved.connect(lender).approve(await protocol.getAddress(), ethers.parseUnits("100", 6));
    await expectCustomError(
      protocol
        .connect(lender)
        .createErc20Pool(
          await unapproved.getAddress(),
          ethers.parseEther("0.0005"),
          650,
          2_500,
          900,
          30 * 24 * 60 * 60,
          ethers.parseUnits("10", 6),
          ethers.parseUnits("100", 6)
        ),
      "AssetNotApproved"
    );
  });

  it("moves overdue active loans into default and credits native collateral to pool liquidity", async function () {
    const { protocol, lender, borrower } = await deployFixture();
    await submitAndPublishScore(protocol, borrower, lender, [75, 75, 70, 70, 80]);

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
    const profile = await protocol.profiles(borrower.address);

    expect(loan.status).to.equal(2n);
    expect(pool.defaultCount).to.equal(1n);
    expect(pool.defaultedPrincipal).to.equal(principal);
    expect(profile.loansDefaulted).to.equal(1n);
    expect(await protocol.scoreRefreshAdjustment(borrower.address)).to.equal(-35n);
    await expectCustomError(
      protocol.connect(borrower).borrow(1, ethers.parseEther("0.1"), { value: ethers.parseEther("0.05") }),
      "ScoreStale"
    );
    await expectCustomError(protocol.connect(borrower).issueScoreAttestation(650), "ScoreStale");

    const refreshedScore = await submitAndPublishScore(protocol, borrower, lender, [0, 0, 0, 0, 0], true);
    expect(refreshedScore).to.equal(300);
  });

  it("rejects encrypted score snapshots that are not signed by the credit attester", async function () {
    const { protocol, borrower, other } = await deployFixture();
    const client = await hre.cofhe.createClientWithBatteries(borrower);
    const encrypted = await client
      .encryptInputs([80, 90, 70, 80, 75].map((value) => Encryptable.uint32(BigInt(value))))
      .execute();
    const badAuthorization = await authorizeScoreSnapshot(protocol, other, borrower.address, encrypted, false);

    await expectCustomError(
      protocol
        .connect(borrower)
        .submitEncryptedSnapshot(encrypted[0], encrypted[1], encrypted[2], encrypted[3], encrypted[4], badAuthorization),
      "InvalidCreditAuthorization"
    );
  });

  it("allows a guardian emergency pause and owner-only recovery", async function () {
    const { protocol, lender, guardian } = await deployFixture();

    await protocol.setGuardian(guardian.address);
    await protocol.connect(guardian).emergencyPause();

    await expectCustomError(
      protocol.connect(lender).createPool(650, 4_000, 1_200, 30 * 24 * 60 * 60, ethers.parseEther("1"), {
        value: ethers.parseEther("5"),
      }),
      "EnforcedPause"
    );

    await protocol.emergencyUnpause();
    await protocol.connect(lender).createPool(650, 4_000, 1_200, 30 * 24 * 60 * 60, ethers.parseEther("1"), {
      value: ethers.parseEther("5"),
    });
    expect(await protocol.poolCount()).to.equal(1n);
  });
});
