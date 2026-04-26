const fs = require("fs");
const { ethers } = require("ethers");

const ABI_PATH = "/backend/src/abi/MyToken.json";
const RPC_URL = "http://127.0.0.1:8545";

async function main() {
  if (!fs.existsSync(ABI_PATH)) {
    process.exit(1);
  }

  const tokenJson = JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
  if (!tokenJson?.address || !Array.isArray(tokenJson?.abi)) {
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(tokenJson.address, tokenJson.abi, provider);

  await contract.name();
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
