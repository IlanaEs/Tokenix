import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("GuardedFaucet", function () {
  async function deployFixture() {
    const [owner, otherAccount, recipient, recoveryOwner] = await ethers.getSigners();
    const claimAmount = ethers.parseEther("100");

    const Token = await ethers.getContractFactory("MyToken");
    const token = await Token.deploy(
      "Tokenix",
      "TNX",
      owner.address,
      ethers.parseEther("1000000")
    );

    const Faucet = await ethers.getContractFactory("GuardedFaucet");
    const faucet = await Faucet.deploy(token.target, owner.address, claimAmount);
    await token.transferOwnership(faucet.target);

    return { token, faucet, owner, otherAccount, recipient, recoveryOwner, claimAmount };
  }

  it("allows the owner to perform one guarded claim", async function () {
    const { token, faucet, recipient, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await expect(faucet.claim(recipient.address, requestId, claimAmount))
      .to.emit(faucet, "FaucetClaimed")
      .withArgs(requestId, recipient.address, claimAmount);

    expect(await token.balanceOf(recipient.address)).to.equal(claimAmount);
    expect(await faucet.walletClaimed(recipient.address)).to.equal(true);
    expect(await faucet.requestUsed(requestId)).to.equal(true);
  });

  it("rejects a duplicate wallet claim", async function () {
    const { faucet, recipient, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await faucet.claim(recipient.address, requestId, claimAmount);

    await expect(
      faucet.claim(recipient.address, requestId, claimAmount)
    ).to.be.revertedWith("FAUCET: wallet claimed");
  });

  it("rejects a duplicate request ID for another wallet", async function () {
    const { faucet, recipient, otherAccount, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await faucet.claim(recipient.address, requestId, claimAmount);

    await expect(
      faucet.claim(otherAccount.address, requestId, claimAmount)
    ).to.be.revertedWith("FAUCET: invalid request");
  });

  it("rejects non-owner claims", async function () {
    const { faucet, otherAccount, recipient, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await expect(
      faucet.connect(otherAccount).claim(recipient.address, requestId, claimAmount)
    ).to.be.revertedWithCustomError(faucet, "OwnableUnauthorizedAccount");
  });

  it("enforces the fixed claim amount", async function () {
    const { faucet, recipient, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await expect(
      faucet.claim(recipient.address, requestId, claimAmount - 1n)
    ).to.be.revertedWith("FAUCET: invalid amount");
  });

  it("does not affect normal ERC-20 transfers", async function () {
    const { token, faucet, recipient, otherAccount, claimAmount } = await deployFixture();
    const requestId = await faucet.computeRequestId(recipient.address);

    await faucet.claim(recipient.address, requestId, claimAmount);
    await token.connect(recipient).transfer(otherAccount.address, ethers.parseEther("1"));

    expect(await token.balanceOf(otherAccount.address)).to.equal(ethers.parseEther("1"));
  });

  it("can recover token ownership for rollback", async function () {
    const { token, faucet, recoveryOwner } = await deployFixture();

    await expect(faucet.recoverTokenOwnership(recoveryOwner.address))
      .to.emit(faucet, "TokenOwnershipRecovered")
      .withArgs(recoveryOwner.address);

    expect(await token.owner()).to.equal(recoveryOwner.address);
  });
});
