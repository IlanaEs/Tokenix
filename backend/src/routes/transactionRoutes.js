import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getTransactionsByUserId,
  processTransferE2E,
} from "../services/transactionService.js";

export const transactionRoutes = express.Router();

const ALLOWED_TYPES = new Set(["SYSTEM_FUNDING", "USER_TRANSFER"]);

transactionRoutes.get("/", requireAuth, async (req, res) => {
  try {
    const rawType = req.query.type;
    const type = rawType ? String(rawType).trim().toUpperCase() : null;

    if (type && !ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid transaction type filter" });
    }

    const rows = await getTransactionsByUserId(req.user.id, type);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: "Failed to fetch transactions" });
  }
});

transactionRoutes.post("/transfer", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { toAddress, amount } = req.body;

    if (toAddress === undefined || toAddress === null || amount === undefined || amount === null) {
      return res.status(400).json({ error: "toAddress and amount are required" });
    }

    const tx = await processTransferE2E({ userId, toAddress, amount });
    return res.status(201).json(tx);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});
