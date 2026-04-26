import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'http://hardhat:8545';
const MINT_AMOUNT = ethers.parseUnits('100', 18);
const TRANSFER_AMOUNT = ethers.parseUnits('10', 18);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ABI_FILE = path.resolve(__dirname, '../src/abi/MyToken.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC error calling ${method}`);
  }

  return payload.result;
}

async function waitForRpc(url, attempts = 60, delayMs = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rpcCall(url, 'eth_blockNumber');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('RPC endpoint did not become ready');
}

async function waitForContractCode(provider, contractAddress, attempts = 60, delayMs = 1000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await provider.getCode(contractAddress);
    if (code && code !== '0x') {
      return;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(`Contract code not found at ${contractAddress} after waiting`);
}

async function main() {
  try {
    if (!fs.existsSync(ABI_FILE)) {
      throw new Error(`ABI file not found at ${ABI_FILE}`);
    }

    const tokenJson = JSON.parse(fs.readFileSync(ABI_FILE, 'utf8'));
    if (!tokenJson.address || !Array.isArray(tokenJson.abi)) {
      throw new Error('MyToken.json is missing address or abi');
    }

    await waitForRpc(RPC_URL);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    await provider.getBlockNumber();

    await waitForContractCode(provider, tokenJson.address);

    const accounts = await provider.send('eth_accounts', []);
    if (!accounts || accounts.length < 3) {
      throw new Error('Need at least 3 Hardhat accounts to run the health check');
    }

    const [ownerAddress, senderAddress, recipientAddress] = accounts;
    const ownerSigner = await provider.getSigner(ownerAddress);
    const senderSigner = await provider.getSigner(senderAddress);

    const contract = new ethers.Contract(tokenJson.address, tokenJson.abi, provider);

    const senderBefore = await contract.balanceOf(senderAddress);
    const recipientBefore = await contract.balanceOf(recipientAddress);

    const mintTx = await contract.connect(ownerSigner).mint(senderAddress, MINT_AMOUNT);
    const mintReceipt = await provider.waitForTransaction(mintTx.hash);
    if (!mintReceipt || Number(mintReceipt.status) !== 1) {
      throw new Error('Mint transaction failed');
    }

    const senderAfterMint = await contract.balanceOf(senderAddress);
    if (senderAfterMint < senderBefore + MINT_AMOUNT) {
      throw new Error('Mint did not increase sender balance as expected');
    }

    const transferTx = await contract.connect(senderSigner).transfer(recipientAddress, TRANSFER_AMOUNT);
    const transferReceipt = await provider.waitForTransaction(transferTx.hash);
    if (!transferReceipt || Number(transferReceipt.status) !== 1) {
      throw new Error('Transfer transaction failed on-chain');
    }

    const senderAfter = await contract.balanceOf(senderAddress);
    const recipientAfter = await contract.balanceOf(recipientAddress);

    const expectedSenderAfter = senderAfterMint - TRANSFER_AMOUNT;
    const expectedRecipientAfter = recipientBefore + TRANSFER_AMOUNT;

    if (senderAfter !== expectedSenderAfter) {
      throw new Error(`Sender balance mismatch: expected ${expectedSenderAfter}, got ${senderAfter}`);
    }

    if (recipientAfter !== expectedRecipientAfter) {
      throw new Error(`Recipient balance mismatch: expected ${expectedRecipientAfter}, got ${recipientAfter}`);
    }

    console.log('Blockchain health check passed.');
    console.log({
      rpcUrl: RPC_URL,
      contractAddress: tokenJson.address,
      ownerAddress,
      senderAddress,
      recipientAddress,
      senderBefore: ethers.formatUnits(senderBefore, 18),
      senderAfterMint: ethers.formatUnits(senderAfterMint, 18),
      senderAfter: ethers.formatUnits(senderAfter, 18),
      recipientBefore: ethers.formatUnits(recipientBefore, 18),
      recipientAfter: ethers.formatUnits(recipientAfter, 18),
      mintTxHash: mintTx.hash,
      transferTxHash: transferTx.hash,
    });
  } catch (error) {
    console.error('Blockchain health check failed:');
    console.error(error);
    process.exit(1);
  }
}

main();