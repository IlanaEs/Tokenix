import process from "process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const TRANSFER_AMOUNT = "10";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokenArtifact = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../src/abi/MyToken.json"), "utf8")
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const rawBody = await response.text();
  let body = rawBody;

  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Keep the raw body for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${path}: ${rawBody}`);
  }

  return body;
}

async function expectHttpError(path, options, expectedStatus) {
  try {
    await request(path, options);
  } catch (error) {
    if (error.message.includes(`HTTP ${expectedStatus} ${path}:`)) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected HTTP ${expectedStatus} for ${path}, but request succeeded.`);
}

function authHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function waitForRpcReady(provider, maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw new Error("Hardhat RPC not ready after waiting.");
      }

      await sleep(delayMs);
    }
  }
}

async function waitForContractReady(provider, contractAddress, maxAttempts = 60, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = await provider.getCode(contractAddress);
    if (code && code !== "0x") {
      return;
    }

    if (attempt === maxAttempts - 1) {
      throw new Error(`Contract code not found at ${contractAddress} after waiting.`);
    }

    await sleep(delayMs);
  }
}

async function waitForWalletBalance(token, expectedMinimum, maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const balance = await request("/wallet/balance", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (Number(balance.balance) >= expectedMinimum) {
      return balance;
    }

    await sleep(delayMs);
  }

  throw new Error(`Wallet balance did not reach ${expectedMinimum} TNX after waiting.`);
}

async function waitForTransactionStatus(token, txHash, expectedStatus = "CONFIRMED", maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transactions = await request("/transactions?type=USER_TRANSFER", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const transaction = transactions.find(
      (item) => item.txHash?.toLowerCase() === txHash.toLowerCase()
    );

    if (transaction?.status === expectedStatus) {
      return transaction;
    }

    await sleep(delayMs);
  }

  throw new Error(`Transaction ${txHash} did not reach ${expectedStatus} status.`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await waitForRpcReady(provider);
  await waitForContractReady(provider, tokenArtifact.address);

  const email = `transaction-flow-${randomUUID()}@tokenix.local`;
  const password = "Passw0rd!";
  const senderWallet = ethers.Wallet.createRandom();
  const recipientWallet = ethers.Wallet.createRandom();
  const senderAddress = ethers.getAddress(senderWallet.address);
  const recipientAddress = ethers.getAddress(recipientWallet.address);
  const contract = new ethers.Contract(
    tokenArtifact.address,
    tokenArtifact.abi,
    senderWallet.connect(provider)
  );

  console.log("Registering user:", email);
  const registered = await request("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const token = registered.token;
  if (!token) {
    throw new Error("Registration did not return an auth token.");
  }

  console.log("Creating wallet:", senderAddress);
  await request("/wallet/create", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      walletAddress: senderAddress,
      publicKey: senderWallet.signingKey.publicKey,
    }),
  });

  const fundedBalance = await waitForWalletBalance(token, 100);
  console.log("Wallet balance after provisioning:", fundedBalance.balance);

  const recipientBalanceBefore = await contract.balanceOf(recipientAddress);
  const transferValue = ethers.parseUnits(TRANSFER_AMOUNT, 18);

  console.log("Broadcasting frontend-signed transfer...");
  const txResponse = await contract.transfer(recipientAddress, transferValue);
  console.log("Broadcast tx hash:", txResponse.hash);

  const recorded = await request("/transactions/transfer", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      txHash: txResponse.hash,
      fromAddress: senderAddress,
      toAddress: recipientAddress,
      amount: TRANSFER_AMOUNT,
    }),
  });

  if (recorded.status !== "PENDING") {
    throw new Error(`Expected backend to initially record PENDING, got ${recorded.status}`);
  }

  const confirmed = await waitForTransactionStatus(token, txResponse.hash, "CONFIRMED");
  const receipt = await provider.getTransactionReceipt(txResponse.hash);
  const recipientBalanceAfter = await contract.balanceOf(recipientAddress);

  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error("On-chain transaction receipt is not successful.");
  }

  if (recipientBalanceAfter - recipientBalanceBefore !== transferValue) {
    throw new Error("Recipient balance did not increase by the transfer amount.");
  }

  await expectHttpError(
    "/transactions/transfer",
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        txHash: txResponse.hash,
        fromAddress: senderAddress,
        toAddress: recipientAddress,
        amount: TRANSFER_AMOUNT,
      }),
    },
    409
  );

  console.log("Backend tx id:", confirmed.txId);
  console.log("Backend status:", confirmed.status);
  console.log("Confirmed at:", confirmed.confirmedAt);
  console.log("Recipient balance before:", ethers.formatUnits(recipientBalanceBefore, 18));
  console.log("Recipient balance after:", ethers.formatUnits(recipientBalanceAfter, 18));
  console.log("All HTTP transaction-flow checks passed.");
}

main().catch((error) => {
  console.error("HTTP transaction-flow test failed:", error);
  process.exit(1);
});
