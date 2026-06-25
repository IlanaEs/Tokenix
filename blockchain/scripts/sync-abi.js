import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACTS = [
  {
    fileName: 'MyToken.json',
    artifactPath: path.join(__dirname, '../artifacts/contracts/Token.sol/MyToken.json'),
    addressKeys: ['TokenModule#MyToken'],
  },
  {
    fileName: 'GuardedFaucet.json',
    artifactPath: path.join(__dirname, '../artifacts/contracts/GuardedFaucet.sol/GuardedFaucet.json'),
    addressKeys: ['TokenModule#GuardedFaucet'],
  },
];
const EPOCH_FILE_NAME = 'DeploymentEpoch.json';
const DEPLOYMENTS_DIR = path.join(__dirname, '../ignition/deployments');

const TARGET_DIRS = [
  path.join(__dirname, '../../backend/src/abi/'),
  path.join(__dirname, '../../frontend/src/abi/')
];

function sync() {
  try {
    console.log("🧹 Starting cleanup: Removing old ABI files...");

    TARGET_DIRS.forEach(targetDir => {
      CONTRACTS.forEach(contract => {
        const fullPath = path.join(targetDir, contract.fileName);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`   - Deleted old file: ${fullPath}`);
        }
      });
      const epochPath = path.join(targetDir, EPOCH_FILE_NAME);
      if (fs.existsSync(epochPath)) {
        fs.unlinkSync(epochPath);
        console.log(`   - Deleted old file: ${epochPath}`);
      }
    });

    if (!fs.existsSync(DEPLOYMENTS_DIR)) throw new Error(`Deployments directory not found: ${DEPLOYMENTS_DIR}`);
    
    const entries = fs.readdirSync(DEPLOYMENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        name: d.name,
        time: fs.statSync(path.join(DEPLOYMENTS_DIR, d.name)).mtimeMs
      }));

    if (entries.length === 0) throw new Error(`No deployment folders found in ${DEPLOYMENTS_DIR}`);
    
    entries.sort((a, b) => b.time - a.time);
    const latestFolder = entries[0].name;
    const ADDRESS_SOURCE = path.join(DEPLOYMENTS_DIR, latestFolder, 'deployed_addresses.json');

    if (!fs.existsSync(ADDRESS_SOURCE)) throw new Error(`deployed_addresses.json not found in ${latestFolder}`);
    
    const addresses = JSON.parse(fs.readFileSync(ADDRESS_SOURCE, 'utf8'));
    const epoch = {
      deploymentFolder: latestFolder,
      deploymentMarker: `${latestFolder}:${fs.statSync(ADDRESS_SOURCE).mtimeMs}`,
      chainEpochId: `${latestFolder}:${fs.statSync(ADDRESS_SOURCE).mtimeMs}`,
      syncedAt: new Date().toISOString(),
    };

    CONTRACTS.forEach(contract => {
      if (!fs.existsSync(contract.artifactPath)) {
        throw new Error(`ABI artifact not found at ${contract.artifactPath}`);
      }

      const abiArtifact = JSON.parse(fs.readFileSync(contract.artifactPath, 'utf8'));
      const abi = abiArtifact.abi;
      if (!abi) throw new Error(`ABI array not found in ${contract.artifactPath}`);

      const contractAddress = contract.addressKeys
        .map(key => addresses[key])
        .find(Boolean);

      if (!contractAddress) {
        throw new Error(`${contract.fileName} address not found in deployed_addresses.json`);
      }

      const output = {
        address: contractAddress,
        abi,
      };

      TARGET_DIRS.forEach(targetDir => {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const outPath = path.join(targetDir, contract.fileName);
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
      });

      console.log(`📍 ${contract.fileName}: ${contractAddress}`);
    });

    TARGET_DIRS.forEach(targetDir => {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(path.join(targetDir, EPOCH_FILE_NAME), JSON.stringify(epoch, null, 2));
    });

    console.log(`\n✅ Sync Complete!`);
    console.log(`🚀 Deployment: ${latestFolder}`);
    console.log(`📂 Copied to: ${TARGET_DIRS.join(', ')}`);

  } catch (error) {
    console.error("\n❌ Sync failed!");
    console.error(`Reason: ${error.message}`);
    process.exit(1);
  }
}

sync();
