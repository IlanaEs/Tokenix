// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Tokenix Token
/// @notice A placeholder ERC‑20 contract for the Tokenix project
contract MyToken is ERC20, Ownable {
    /// @notice Constructor mints an initial supply to the deployer
    /// @param initialSupply The number of tokens (in wei) to mint on deployment
    constructor(uint256 initialSupply)
        ERC20("TokenixToken", "TNX")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Mint new tokens to a recipient (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint (in wei)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
