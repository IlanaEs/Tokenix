import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("MyToken", function () {
  async function deployTokenFixture() {
    const [owner, otherAccount] = await ethers.getSigners();

    const name = "Tokenix";
    const symbol = "TNX";
    const maxSupply = ethers.parseEther("1000000"); // 1M tokens

    const Token = await ethers.getContractFactory("MyToken");
    // Deploy with owner address and max supply
    const token = await Token.deploy(name, symbol, owner.address, maxSupply);

    return { token, owner, otherAccount, maxSupply, name, symbol };
  }

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      const { token, name, symbol } = await deployTokenFixture();

      expect(await token.name()).to.equal(name);
      expect(await token.symbol()).to.equal(symbol);
    });

    it("Should set the right owner", async function () {
      const { token, owner } = await deployTokenFixture();

      expect(await token.owner()).to.equal(owner.address);
    });

    it("Should assign the max supply correctly", async function () {
      const { token, maxSupply } = await deployTokenFixture();

      expect(await token.maxSupply()).to.equal(maxSupply);
    });

    it("Should have 0 initial total supply", async function () {
        const { token } = await deployTokenFixture();
  
        expect(await token.totalSupply()).to.equal(0);
      });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
        const { token, owner } = await deployTokenFixture();
        const mintAmount = ethers.parseEther("100");
  
        await token.mint(owner.address, mintAmount);
        expect(await token.balanceOf(owner.address)).to.equal(mintAmount);
    });

    it("Should fail if non-owner tries to mint", async function () {
        const { token, otherAccount } = await deployTokenFixture();
        const mintAmount = ethers.parseEther("100");
  
        await expect(
          token.connect(otherAccount).mint(otherAccount.address, mintAmount)
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("Should fail if minting exceeds max supply", async function () {
        const { token, owner, maxSupply } = await deployTokenFixture();
        
        // Mint max supply first
        await token.mint(owner.address, maxSupply);
        
        // Try to mint 1 more wei
        await expect(
            token.mint(owner.address, 1n)
        ).to.be.revertedWith("Tokenix: Exceeds max supply");
    });
  });
});
