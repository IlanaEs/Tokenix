import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { createWallet, getBalance } from "../services/walletService.js";

export const walletRoutes = express.Router();

function isBlockchainFailure(error) {
  const message = (error?.message || "").toLowerCase();
  const status = error?.status || error?.statusCode;

  return (
    status === 502 ||
    status === 503 ||
    message.includes("blockchain client is not configured") ||
    message.includes("contract") ||
    message.includes("rpc") ||
    message.includes("network") ||
    message.includes("could not connect") ||
    message.includes("connection refused") ||
    message.includes("failed to detect network") ||
    message.includes("bad_data") ||
    message.includes("could not decode result data")
  );
}

walletRoutes.post("/create", requireAuth, async (req, res) => {
  try {
    const { walletAddress, publicKey } = req.body || {};
    if (!walletAddress || !publicKey) {
      return res.status(400).json({ message: "walletAddress and publicKey are required" });
    }

    const created = await createWallet({
      userId: req.user.id,
      walletAddress,
      publicKey,
    });

    return res.status(201).json(created);
  } catch (error) {
    console.error("Wallet creation failed:", error);
    const status = error?.status || error?.statusCode;

    if (status === 409) {
      return res.status(409).json({
        message: error.message || "Wallet already exists",
      });
    }

    return res.status(500).json({ message: "Failed to create wallet" });
  }
});

walletRoutes.get("/balance", requireAuth, async (req, res) => {
  try {
    const data = await getBalance(req.user.id);
    if (!data) return res.status(404).json({ message: "Wallet not found" });
    return res.json(data);
  } catch (error) {
    console.error("Wallet balance lookup failed:", error);
    const status = error?.status || error?.statusCode;

    if (status === 404) {
      return res.status(404).json({ message: error.message || "Wallet not found" });
    }

    if (status === 502 || status === 503 || isBlockchainFailure(error)) {
      return res.status(502).json({
        message: "Blockchain service unavailable",
      });
    }

    return res.status(500).json({ message: "Failed to fetch wallet balance" });
  }
});
