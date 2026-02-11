import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { createWallet, getBalance } from "../services/walletService.js";

export const walletRoutes = express.Router();

walletRoutes.post("/create", requireAuth, async (req, res) => {
  const { walletAddress, publicKey } = req.body || {};
  if (!walletAddress || !publicKey) {
    return res.status(400).json({ message: "walletAddress and publicKey are required" });
  }

  const created = await createWallet({
    userId: req.user.id,
    walletAddress,
    publicKey,
  });

  if (!created) {
    return res.status(409).json({ message: "Wallet already exists or address is taken" });
  }

  return res.status(201).json(created);
});

walletRoutes.get("/balance", requireAuth, async (req, res) => {
  const data = await getBalance(req.user.id);
  if (!data) return res.status(404).json({ message: "Wallet not found" });
  return res.json(data);
});
