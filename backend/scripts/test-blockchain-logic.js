import process from 'process';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure RPC points to local Hardhat node
process.env.RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// normalize path on Windows and other platforms
const ABI_FILE = path.resolve(__dirname, '../src/abi/MyToken.json');

async function main() {
  try {
    if (!fs.existsSync(ABI_FILE)) {
      throw new Error(`ABI file not found at ${ABI_FILE}. Run full-deploy first.`);
    }

    // Dynamic import after setting env var so BlockchainClient picks up RPC_URL
    const { default: BlockchainClient } = await import('../src/services/BlockchainClient.js');

    const client = new BlockchainClient();
    if (!client.isConfigured()) {
      throw new Error('BlockchainClient is not configured. Ensure ABI and contract address are present.');
    }

    const provider = client.provider;

    // Get available accounts
    const accounts = await provider.listAccounts();
    if (!accounts || accounts.length < 2) {
      throw new Error('Not enough accounts available from provider (need at least 2)');
    }

    const admin = (typeof accounts[0] === 'string') ? accounts[0] : accounts[0].address || accounts[0];
    const sender = (typeof accounts[1] === 'string') ? accounts[1] : accounts[1].address || accounts[1];

    console.log('Using admin:', admin);
    console.log('Using sender (will perform transfer):', sender);

    // Step 1: Funding
    const randomWallet = ethers.Wallet.createRandom();
    const newAddress = randomWallet.address;
    console.log('New random address:', newAddress);

    const ethBefore = await provider.getBalance(newAddress);
    console.log('ETH balance before funding:', ethers.formatEther(ethBefore));

    const fundTxHash = await client.fundAccount(newAddress, '0.005');
    console.assert(typeof fundTxHash === 'string' && fundTxHash.length > 0, 'fundAccount did not return a tx hash');
    console.log('Funding tx hash:', fundTxHash);

    const fundReceipt = await client.waitForTransaction(fundTxHash);
    console.assert(fundReceipt && fundReceipt.status === 1, 'Funding transaction failed');

    const ethAfter = await provider.getBalance(newAddress);
    console.log('ETH balance after funding:', ethers.formatEther(ethAfter));

    const diff = ethAfter - ethBefore;
    const expected = ethers.parseEther('0.005');
    if (diff < expected) {
      throw new Error(`Funding amount incorrect: expected >= ${ethers.formatEther(expected)}, got ${ethers.formatEther(diff)}`);
    }

    // Step 2: Ensure sender has tokens by minting as admin
    const adminSigner = await client._getAdminSigner();
    const mintAmount = ethers.parseUnits('100', 18);
    console.log(`Minting ${ethers.formatUnits(mintAmount, 18)} tokens to sender ${sender}`);
    const mintTx = await client.contract.connect(adminSigner).mint(sender, mintAmount);
    await client.waitForTransaction(mintTx.hash);

    // Step 2: Transfer tokens from sender to newAddress
    const transferAmount = '10';
    const txHash = await client.transfer({ fromAddress: sender, toAddress: newAddress, amount: transferAmount });
    console.assert(typeof txHash === 'string' && txHash.length > 0, 'transfer did not return a tx hash');
    console.log('Transfer tx hash:', txHash);

    // Step 3: Validate
    const txReceipt = await client.waitForTransaction(txHash);
    console.assert(txReceipt && txReceipt.status === 1, 'Transfer transaction failed on-chain');
    console.log('Transfer confirmed in block', txReceipt.blockNumber);

    const tokenBalance = await client.getBalance(newAddress);
    console.log('Recipient token balance:', tokenBalance);

    const numericBalance = Number(tokenBalance);
    if (Number.isNaN(numericBalance) || numericBalance < Number(transferAmount)) {
      throw new Error(`Token balance assertion failed. Expected >= ${transferAmount}, got ${tokenBalance}`);
    }

    console.log('All checks passed.');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();
