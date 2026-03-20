import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// הגדרות ESM לנתיבים
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// מקורות (Sources)
const ABI_SOURCE = path.join(__dirname, '../artifacts/contracts/Token.sol/MyToken.json');
const DEPLOYMENTS_DIR = path.join(__dirname, '../ignition/deployments');

// יעדים (Targets) - כאן הקבצים ידרסו
const TARGET_DIRS = [
  path.join(__dirname, '../../backend/src/abi/'),
  path.join(__dirname, '../../frontend/src/abi/')
];
const FILE_NAME = 'MyToken.json';

function sync() {
  try {
    console.log("🧹 Starting cleanup: Removing old ABI files...");

    // שלב 0: מחיקת קבצים קיימים ביעדים כדי למנוע בלבול
    TARGET_DIRS.forEach(targetDir => {
      const fullPath = path.join(targetDir, FILE_NAME);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`   - Deleted old file: ${fullPath}`);
      }
    });

    // 1. קריאת ה-ABI artifact
    if (!fs.existsSync(ABI_SOURCE)) throw new Error(`ABI artifact not found at ${ABI_SOURCE}`);
    const abiArtifact = JSON.parse(fs.readFileSync(ABI_SOURCE, 'utf8'));
    const abi = abiArtifact.abi;
    if (!abi) throw new Error('ABI array not found in artifact');

    // 2. מציאת תיקיית ה-deployments האחרונה
    if (!fs.existsSync(DEPLOYMENTS_DIR)) throw new Error(`Deployments directory not found: ${DEPLOYMENTS_DIR}`);
    
    const entries = fs.readdirSync(DEPLOYMENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        name: d.name,
        time: fs.statSync(path.join(DEPLOYMENTS_DIR, d.name)).mtimeMs
      }));

    if (entries.length === 0) throw new Error(`No deployment folders found in ${DEPLOYMENTS_DIR}`);
    
    // מיון לפי זמן שינוי אחרון
    entries.sort((a, b) => b.time - a.time);
    const latestFolder = entries[0].name;
    const ADDRESS_SOURCE = path.join(DEPLOYMENTS_DIR, latestFolder, 'deployed_addresses.json');

    if (!fs.existsSync(ADDRESS_SOURCE)) throw new Error(`deployed_addresses.json not found in ${latestFolder}`);
    
    const addresses = JSON.parse(fs.readFileSync(ADDRESS_SOURCE, 'utf8'));
    
    // שליפת הכתובת - תמיכה בכמה פורמטים של Ignition
    const contractAddress = addresses['TokenModule#MyToken'] || Object.values(addresses)[0];
    
    if (!contractAddress) throw new Error('Contract address not found in deployed_addresses.json');

    const output = {
      address: contractAddress,
      abi: abi
    };

    // 3. כתיבה מחדש ליעדים
    TARGET_DIRS.forEach(targetDir => {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const outPath = path.join(targetDir, FILE_NAME);
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    });

    console.log(`\n✅ Sync Complete!`);
    console.log(`📍 Contract: ${contractAddress}`);
    console.log(`🚀 Deployment: ${latestFolder}`);
    console.log(`📂 Copied to: ${TARGET_DIRS.join(', ')}`);

  } catch (error) {
    console.error("\n❌ Sync failed!");
    console.error(`Reason: ${error.message}`);
    process.exit(1);
  }
}

sync();