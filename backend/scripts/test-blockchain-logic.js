import process from 'process';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

// Ensure RPC points to local Hardhat node
process.env.RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// normalize path on Windows and other platforms
const ABI_FILE = path.resolve(__dirname, '../src/abi/MyToken.json');

async function waitForRpcReady(provider, maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw new Error('Hardhat RPC not ready after waiting.');
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function waitForContractReady(provider, contractAddress, maxAttempts = 60, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = await provider.getCode(contractAddress);
    if (code && code !== '0x') {
      return;
    }

    if (attempt === maxAttempts - 1) {
      throw new Error(`Contract code not found at ${contractAddress} after waiting.`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function createTemporaryWalletRecord(wallet) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    const email = `shelley-${randomUUID()}@tokenix.local`;
    const passwordHash = 'temporary-test-password-hash';
    const publicKey = wallet.signingKey?.publicKey || null;

    const userResult = await dbClient.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id AS "userId"',
      [email, passwordHash]
    );

    const userId = userResult.rows[0].userId;

    await dbClient.query(
      'INSERT INTO wallets (user_id, wallet_address, public_key) VALUES ($1, $2, $3)',
      [userId, wallet.address, publicKey]
    );

    await dbClient.query('COMMIT');

    return { userId, email };
  } catch (error) {
    await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    dbClient.release();
  }
}

async function impersonateAccount(provider, address) {
  await provider.send('hardhat_impersonateAccount', [address]);
}

async function waitForTransactionStatus(txId, expectedStatus = 'CONFIRMED', maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { rows } = await pool.query(
      `
        SELECT status,
               confirmed_at AS "confirmedAt",
               tx_hash AS "txHash"
        FROM transactions
        WHERE tx_id = $1
        LIMIT 1
      `,
      [txId]
    );

    const row = rows[0];
    if (row?.status === expectedStatus) {
      return row;
    }

    if (attempt === maxAttempts - 1) {
      throw new Error(`Transaction ${txId} did not reach ${expectedStatus} status`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main() {
  try {
    if (!fs.existsSync(ABI_FILE)) {
      throw new Error(`ABI file not found at ${ABI_FILE}. Run full-deploy first.`);
    }

    // Dynamic import after setting env var so BlockchainClient picks up RPC_URL.
    const { default: BlockchainClient } = await import('../src/services/BlockchainClient.js');

    const client = new BlockchainClient();
    if (!client.isConfigured()) {
      throw new Error('BlockchainClient is not configured. Ensure ABI and contract address are present.');
    }

    const provider = client.provider;
    await waitForRpcReady(provider);
    await waitForContractReady(provider, client.contractAddress);

    const senderWallet = ethers.Wallet.createRandom();
    const recipientWallet = ethers.Wallet.createRandom();
    const senderAddress = senderWallet.address;
    const recipientAddress = recipientWallet.address;
    const transferAmount = '10';

    const originalTransfer = BlockchainClient.prototype.transfer;
    BlockchainClient.prototype.transfer = async function patchedTransfer({ fromAddress, toAddress, amount }) {
      if (fromAddress && fromAddress.toLowerCase() === senderAddress.toLowerCase()) {
        const signer = senderWallet.connect(this.provider);
        const contractWithSigner = this.contract.connect(signer);
        const value = ethers.parseUnits(String(amount), 18);
        const txResponse = await contractWithSigner.transfer(toAddress, value);
        return txResponse.hash;
      }

      return originalTransfer.call(this, { fromAddress, toAddress, amount });
    };

    const { buildTransferMessage, processTransferE2E } = await import('../src/services/transactionService.js');

    const { userId } = await createTemporaryWalletRecord(senderWallet);

    console.log('Using sender wallet address:', senderAddress);
    console.log('Using recipient address:', recipientAddress);
    console.log('Temporary user id:', userId);

    const ethBefore = await provider.getBalance(senderAddress);
    const senderBalanceBeforeFunding = await client.contract.balanceOf(senderAddress);
    const recipientBalanceBefore = await client.contract.balanceOf(recipientAddress);

    const fundTxHash = await client.fundAccount(senderAddress);
    if (!fundTxHash || typeof fundTxHash !== 'string') {
      throw new Error('fundAccount did not return a transaction hash');
    }

    const fundReceipt = await client.waitForTransaction(fundTxHash);
    if (!fundReceipt || (fundReceipt.status !== 1n && fundReceipt.status !== 1)) {
      throw new Error('Funding transaction failed');
    }

    const ethAfter = await provider.getBalance(senderAddress);
    const senderBalanceAfterFunding = await client.contract.balanceOf(senderAddress);

    if (ethAfter - ethBefore !== ethers.parseEther('0.005')) {
      throw new Error(`ETH funding amount incorrect for ${senderAddress}`);
    }

    if (senderBalanceAfterFunding - senderBalanceBeforeFunding !== ethers.parseUnits('100', 18)) {
      throw new Error(`TNX provisioning amount incorrect for ${senderAddress}`);
    }

    await impersonateAccount(provider, senderAddress);

    const transferMessage = buildTransferMessage({ amount: transferAmount, toAddress: recipientAddress });
    const signature = await senderWallet.signMessage(transferMessage);

    console.log('Transfer message:', transferMessage);
    console.log('Submitting transfer through transactionService.processTransferE2E...');

    const transferResult = await processTransferE2E({
      userId,
      toAddress: recipientAddress,
      amount: transferAmount,
      signature,
    });

    if (transferResult.status !== 'PENDING') {
      throw new Error(`Expected PENDING status from processTransferE2E, got ${transferResult.status}`);
    }

    if (!transferResult.txHash) {
      throw new Error('processTransferE2E did not return a txHash');
    }

    const transferReceipt = await client.waitForTransaction(transferResult.txHash);
    if (!transferReceipt || (transferReceipt.status !== 1n && transferReceipt.status !== 1)) {
      throw new Error('Transfer transaction failed on-chain');
    }

    const confirmedTransaction = await waitForTransactionStatus(transferResult.txId, 'CONFIRMED');
    if (confirmedTransaction.status !== 'CONFIRMED') {
      throw new Error(`Transaction ${transferResult.txId} did not reach CONFIRMED status`);
    }

    const recipientBalanceAfter = await client.contract.balanceOf(recipientAddress);
    if (recipientBalanceAfter - recipientBalanceBefore !== ethers.parseUnits('10', 18)) {
      throw new Error('Recipient balance did not increase by exactly 10 TNX');
    }

    const senderBalanceAfterTransfer = await client.contract.balanceOf(senderAddress);
    if (senderBalanceAfterFunding - senderBalanceAfterTransfer !== ethers.parseUnits('10', 18)) {
      throw new Error('Sender balance did not decrease by exactly 10 TNX');
    }

    console.log('Transfer tx hash:', transferResult.txHash);
    console.log('Transfer confirmed at:', confirmedTransaction.confirmedAt);
    console.log('Recipient balance before:', ethers.formatUnits(recipientBalanceBefore, 18));
    console.log('Recipient balance after:', ethers.formatUnits(recipientBalanceAfter, 18));
    console.log('All checks passed.');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();
