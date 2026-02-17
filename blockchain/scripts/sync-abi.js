import fs from 'fs';
import path from 'path';

// נתיבי מקור (יחסיים לתיקיית blockchain)
const ABI_SOURCE = './artifacts/contracts/Token.sol/MyToken.json';
const ADDRESS_SOURCE = './ignition/deployments/chain-31337/deployed_addresses.json';

// נתיבי יעד
const TARGETS = [
  '../backend/src/abi/',
  '../frontend/src/abi/' // אם יש לך תיקיית פרונטנד
];

function sync() {
  try {
    // 1. קריאת ה-ABI
    const abiData = JSON.parse(fs.readFileSync(ABI_SOURCE, 'utf8'));
    
    // 2. קריאת הכתובת העדכנית מ-Ignition
    const addresses = JSON.parse(fs.readFileSync(ADDRESS_SOURCE, 'utf8'));
    const contractAddress = addresses["TokenModule#MyToken"];

    const output = {
      address: contractAddress,
      abi: abiData.abi
    };

    // 3. הפצה ליעדים
    TARGETS.forEach(targetDir => {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(targetDir, 'MyToken.json'),
        JSON.stringify(output, null, 2)
      );
    });

    console.log(`✅ ABI and Address (${contractAddress}) synced successfully!`);
  } catch (error) {
    console.error("❌ Sync failed. Make sure you ran 'npx hardhat compile' and 'ignition deploy' first.");
    console.error(error.message);
  }
}

sync();