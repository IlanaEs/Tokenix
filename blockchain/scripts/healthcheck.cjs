const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "http://127.0.0.1:8545";
const ABI_PATH = "/backend/src/abi/MyToken.json";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. Check RPC connectivity.
  await provider.getBlockNumber();

  // 2. Check that full-deploy has synced the ABI/address.
  if (!fs.existsSync(ABI_PATH)) {
    throw new Error(`ABI not synced yet: ${ABI_PATH}`);
  }

  const tokenArtifact = JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
  if (!tokenArtifact.address || !Array.isArray(tokenArtifact.abi)) {
    throw new Error("Synced ABI is missing address or abi");
  }

  // 3. Check that the synced address actually has contract bytecode.
  const code = await provider.getCode(tokenArtifact.address);
  if (!code || code === "0x") {
    throw new Error(`Contract not deployed yet at ${tokenArtifact.address}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(err.message + "\n");
    process.exit(1);
  });
