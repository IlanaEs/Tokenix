import fs from "fs";
import path from "path";
import pkg from "hardhat";

const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MyToken");

  const token = await Token.deploy(
    "MyToken",
    "MTK",
    deployer.address,
    ethers.parseUnits("1000000", 18)
  );

  await token.waitForDeployment();

  const address = await token.getAddress();

  console.log("Deployed to:", address);

  const artifact = await ethers.getContractFactory("MyToken");
  const abi = artifact.interface.fragments;

  const output = {
    address,
    abi: artifact.interface.formatJson()
  };

  const outputPath = path.resolve(
    "../backend/src/abi/MyToken.json"
  );

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log("Deployment artifact written to backend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
