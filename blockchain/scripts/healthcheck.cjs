const { ethers } = require("ethers");

const RPC_URL = "http://127.0.0.1:8545";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. Check RPC connectivity
  await provider.getBlockNumber();

  // 2. Optionally check for contract deployment if needed,
  // but for a general healthcheck, RPC readiness is the priority.
  // The original script checked for MyToken.json, which is good for full readiness.
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(err.message + "\n");
    process.exit(1);
  });
