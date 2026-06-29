import "dotenv/config";
import bcrypt from "bcrypt";
import fs from "fs";
import os from "os";
import path from "path";
import { ethers } from "ethers";
import { pool } from "../src/db.js";
import BlockchainClient from "../src/services/BlockchainClient.js";

const DEMO_USERS = [
  { email: "admin@example.com", role: "ADMIN" },
  { email: "user1@example.com", role: "USER" },
  { email: "user2@example.com", role: "USER" },
];

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const DEMO_WALLET_FILE =
  process.env.DEMO_WALLET_FILE || path.join(os.tmpdir(), "tokenix-demo-wallets.json");
const TRANSFER_AMOUNT = "15";

function requireDemoPassword() {
  if (!DEMO_PASSWORD) {
    throw new Error("DEMO_PASSWORD is required. Provide it as an environment variable.");
  }
}

function readWalletFile() {
  if (!fs.existsSync(DEMO_WALLET_FILE)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(DEMO_WALLET_FILE, "utf8"));
}

function writeWalletFile(wallets) {
  fs.writeFileSync(DEMO_WALLET_FILE, `${JSON.stringify(wallets, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function upsertDemoUser({ email, role }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const { rows } = await pool.query(
    `
    INSERT INTO users (email, password_hash, role, is_frozen)
    VALUES ($1, $2, $3, FALSE)
    ON CONFLICT (email)
    DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          is_frozen = FALSE
    RETURNING user_id AS "userId",
              email,
              role,
              is_frozen AS "isFrozen"
    `,
    [email, passwordHash, role]
  );

  return rows[0];
}

async function getWalletRecord(userId) {
  const { rows } = await pool.query(
    `
    SELECT wallet_address AS "walletAddress",
           public_key AS "publicKey"
    FROM wallets
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

async function ensureWallet(user, walletStore) {
  const existingWallet = await getWalletRecord(user.userId);
  const storedWallet = walletStore[user.email];

  if (existingWallet && storedWallet?.privateKey) {
    return {
      ...existingWallet,
      wallet: new ethers.Wallet(storedWallet.privateKey),
    };
  }

  const wallet = ethers.Wallet.createRandom();
  const walletAddress = ethers.getAddress(wallet.address);
  const publicKey = wallet.signingKey.publicKey;

  await pool.query(
    `
    INSERT INTO wallets (user_id, wallet_address, public_key)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE
      SET wallet_address = EXCLUDED.wallet_address,
          public_key = EXCLUDED.public_key
    `,
    [user.userId, walletAddress, publicKey]
  );

  walletStore[user.email] = {
    walletAddress,
    privateKey: wallet.privateKey,
  };

  return {
    walletAddress,
    publicKey,
    wallet,
  };
}

async function insertTransaction({
  userId,
  type,
  fromAddress,
  toAddress,
  amount,
  txHash,
  status,
  confirmedAt = null,
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO transactions
      (user_id, type, from_address, to_address, amount, tx_hash, status, confirmed_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING tx_id AS "txId",
              tx_hash AS "txHash",
              status
    `,
    [userId, type, fromAddress, toAddress, amount, txHash, status, confirmedAt]
  );

  return rows[0];
}

async function clearExistingDemoTransactions(users) {
  const userIds = users.map((user) => user.userId);

  await pool.query(
    `
    DELETE FROM transactions
    WHERE user_id = ANY($1::int[])
    `,
    [userIds]
  );
}

async function fundWallet({ client, user, walletAddress }) {
  const balance = ethers.parseUnits(await client.getBalance(walletAddress), 18);
  if (balance >= ethers.parseUnits("100", 18)) {
    return null;
  }

  // Token ownership is transferred to the GuardedFaucet at deploy time, so the
  // token can only be minted through the faucet's owner-gated claim() — a direct
  // token.mint() from account 0 (the legacy client.fundAccount path) reverts with
  // OwnableUnauthorizedAccount. Account 0 is the unlocked faucet owner here, so we
  // fund gas from it and claim the fixed faucet amount on the wallet's behalf.
  const adminSigner = await client.provider.getSigner(0);

  const ethTx = await adminSigner.sendTransaction({
    to: walletAddress,
    value: ethers.parseEther("0.01"),
  });
  await client.waitForTransaction(ethTx.hash);

  const requestId = await client.computeFaucetRequestId(walletAddress);
  const claimAmount = await client.faucetContract.claimAmount();
  const claimTx = await client.faucetContract
    .connect(adminSigner)
    .claim(walletAddress, requestId, claimAmount);
  await client.waitForTransaction(claimTx.hash);
  const txHash = claimTx.hash;

  return insertTransaction({
    userId: user.userId,
    type: "SYSTEM_FUNDING",
    fromAddress: null,
    toAddress: walletAddress,
    amount: null,
    txHash,
    status: "CONFIRMED",
    confirmedAt: new Date(),
  });
}

async function createSignedDemoTransfer({ client, provider, fromUser, fromWallet, toWallet }) {
  const signer = fromWallet.wallet.connect(provider);
  const contractWithSigner = client.contract.connect(signer);
  const value = ethers.parseUnits(TRANSFER_AMOUNT, 18);

  const tx = await contractWithSigner.transfer(toWallet.walletAddress, value);
  const receipt = await client.waitForTransaction(tx.hash);

  return insertTransaction({
    userId: fromUser.userId,
    type: "USER_TRANSFER",
    fromAddress: fromWallet.walletAddress,
    toAddress: toWallet.walletAddress,
    amount: TRANSFER_AMOUNT,
    txHash: tx.hash,
    status: Number(receipt.status) === 1 ? "CONFIRMED" : "FAILED",
    confirmedAt: Number(receipt.status) === 1 ? new Date() : null,
  });
}

async function createPendingDemoTransaction({ user, fromWallet, toWallet }) {
  const txHash = ethers.hexlify(ethers.randomBytes(32));

  return insertTransaction({
    userId: user.userId,
    type: "USER_TRANSFER",
    fromAddress: fromWallet.walletAddress,
    toAddress: toWallet.walletAddress,
    amount: "3",
    txHash,
    status: "PENDING",
    confirmedAt: null,
  });
}

async function summarize({ client, users, wallets, transactions }) {
  const balances = [];

  for (const user of users) {
    const wallet = wallets[user.email];
    balances.push({
      email: user.email,
      role: user.role,
      walletAddress: wallet.walletAddress,
      balance: await client.getBalance(wallet.walletAddress),
    });
  }

  return {
    users: balances,
    transactions,
    walletFile: DEMO_WALLET_FILE,
  };
}

async function main() {
  requireDemoPassword();

  const client = new BlockchainClient();
  client.ensureConfigured();
  const provider = client.provider;

  const walletStore = readWalletFile();
  const users = [];
  const wallets = {};
  const transactions = [];

  for (const demoUser of DEMO_USERS) {
    const user = await upsertDemoUser(demoUser);
    const wallet = await ensureWallet(user, walletStore);

    users.push(user);
    wallets[user.email] = {
      walletAddress: wallet.walletAddress,
      publicKey: wallet.publicKey,
      wallet: wallet.wallet,
    };
  }

  writeWalletFile(walletStore);
  await clearExistingDemoTransactions(users);

  for (const user of users) {
    const funding = await fundWallet({
      client,
      user,
      walletAddress: wallets[user.email].walletAddress,
    });

    if (funding) {
      transactions.push(funding);
    }
  }

  const user1 = users.find((user) => user.email === "user1@example.com");
  const user2 = users.find((user) => user.email === "user2@example.com");
  const admin = users.find((user) => user.email === "admin@example.com");

  transactions.push(
    await createSignedDemoTransfer({
      client,
      provider,
      fromUser: user1,
      fromWallet: wallets[user1.email],
      toWallet: wallets[user2.email],
    })
  );

  transactions.push(
    await createSignedDemoTransfer({
      client,
      provider,
      fromUser: user2,
      fromWallet: wallets[user2.email],
      toWallet: wallets[admin.email],
    })
  );

  transactions.push(
    await createPendingDemoTransaction({
      user: user1,
      fromWallet: wallets[user1.email],
      toWallet: wallets[admin.email],
    })
  );

  const summary = await summarize({ client, users, wallets, transactions });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to prepare demo data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
