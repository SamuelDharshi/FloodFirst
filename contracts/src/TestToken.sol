// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FFUSD, the FloodFirst TESTNET token. Has no monetary value. Testnet only.
contract TestToken is ERC20, Ownable {
    constructor(address owner_) ERC20("FloodFirst Test USD (testnet, no value)", "FFUSD") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
