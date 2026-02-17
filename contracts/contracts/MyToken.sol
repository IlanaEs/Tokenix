// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    uint256 public immutable maxSupply;

    constructor(
        string memory name, 
        string memory symbol, 
        address initialOwner,
        uint256 _maxSupplyLimit
    ) ERC20(name, symbol) Ownable(initialOwner) {
        maxSupply = _maxSupplyLimit;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        require(totalSupply() + amount <= maxSupply, "Tokenix: Exceeds max supply");
        _mint(to, amount);
    }
}
