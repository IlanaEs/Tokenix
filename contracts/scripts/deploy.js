const hre = require("hardhat");

async function main() {
  // Define an initial supply of 1 million tokens (adjust as needed)
  const initialSupply = hre.ethers.parseUnits("1000000", 18);

  const Token = await hre.ethers.getContractFactory("MyToken");
  const token = await Token.deploy(initialSupply);
  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log("MyToken deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
