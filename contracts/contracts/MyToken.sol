// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Tokenix Token
/// @notice A placeholder ERC‑20 contract for the Tokenix project
contract MyToken is ERC20 {
    /// @notice Constructor mints an initial supply to the deployer
    /// @param initialSupply The number of tokens (in wei) to mint on deployment
    constructor(uint256 initialSupply) ERC20("TokenixToken", "TNX") {
        _mint(msg.sender, initialSupply);
    }
}