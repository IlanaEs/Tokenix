import fs from "fs";
import path from "path";

const artifactPath = "./artifacts/contracts/MyToken.sol/MyToken.json";
const backendAbiPath = "../backend/src/abi/MyToken.json";

try {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const dataToWrite = {
    address: process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    abi: artifact.abi,
  };

  fs.writeFileSync(
    backendAbiPath,
    JSON.stringify(dataToWrite, null, 2)
  );

  console.log("✅ ABI synced successfully.");
} catch (err) {
  console.error("❌ Sync failed:", err.message);
}
