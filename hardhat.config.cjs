require("@nomicfoundation/hardhat-ethers");
require("@cofhe/hardhat-plugin");
require("dotenv").config();

const normalizePrivateKey = (key) => {
  if (!key) return [];
  const trimmed = key.trim();
  return [trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`];
};

const accounts = normalizePrivateKey(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  cofhe: {
    logMocks: false,
    gasWarning: false,
    mocksDeployVerbosity: "",
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts,
    },
    "arb-sepolia": {
      url: process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts,
    },
  },
};
