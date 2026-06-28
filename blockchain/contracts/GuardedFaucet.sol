// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IFaucetMintableToken {
    function mint(address to, uint256 amount) external;
    function transferOwnership(address newOwner) external;
}

contract GuardedFaucet is Ownable {
    string public constant DOMAIN = "TOKENIX_INITIAL_FAUCET";

    IFaucetMintableToken public immutable token;
    uint256 public immutable claimAmount;

    mapping(address => bool) public walletClaimed;
    mapping(bytes32 => bool) public requestUsed;

    event FaucetClaimed(bytes32 indexed requestId, address indexed wallet, uint256 amount);
    event TokenOwnershipRecovered(address indexed newOwner);

    constructor(address tokenAddress, address initialOwner, uint256 fixedClaimAmount)
        Ownable(initialOwner)
    {
        require(tokenAddress != address(0), "FAUCET: token required");
        require(initialOwner != address(0), "FAUCET: owner required");
        require(fixedClaimAmount > 0, "FAUCET: amount required");

        token = IFaucetMintableToken(tokenAddress);
        claimAmount = fixedClaimAmount;
    }

    function computeRequestId(address wallet) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN,
                block.chainid,
                address(this),
                address(token),
                wallet
            )
        );
    }

    function claim(address wallet, bytes32 requestId, uint256 amount) external onlyOwner {
        require(wallet != address(0), "FAUCET: wallet required");
        require(amount == claimAmount, "FAUCET: invalid amount");
        require(requestId == computeRequestId(wallet), "FAUCET: invalid request");
        require(!walletClaimed[wallet], "FAUCET: wallet claimed");
        require(!requestUsed[requestId], "FAUCET: request used");

        walletClaimed[wallet] = true;
        requestUsed[requestId] = true;

        token.mint(wallet, amount);
        emit FaucetClaimed(requestId, wallet, amount);
    }

    function recoverTokenOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FAUCET: owner required");
        token.transferOwnership(newOwner);
        emit TokenOwnershipRecovered(newOwner);
    }
}
