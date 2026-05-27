// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ShieldScoreUSDC is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10 ** 6;

    constructor(address initialOwner) ERC20("ShieldScore Test USDC", "ssUSDC") Ownable(initialOwner) {
        _mint(initialOwner, 1_000_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
