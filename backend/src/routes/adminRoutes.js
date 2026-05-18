import express from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  getAdminSummary,
  getAdminTransactions,
  getAdminUsers,
  setUserFrozen,
  setUserRole,
} from "../services/adminService.js";

export const adminRoutes = express.Router();

function sendAdminError(res, error) {
  return res.status(error.status || error.statusCode || 500).json({
    message: error.message || "Admin request failed",
  });
}

adminRoutes.get("/summary", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getAdminSummary());
  } catch (error) {
    return sendAdminError(res, error);
  }
});

adminRoutes.get("/users", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getAdminUsers());
  } catch (error) {
    return sendAdminError(res, error);
  }
});

adminRoutes.patch("/users/:userId/freeze", requireAdmin, async (req, res) => {
  try {
    const result = await setUserFrozen({
      currentUserId: req.auth.user.userId,
      userId: req.params.userId,
      isFrozen: req.body?.isFrozen,
    });

    return res.json(result);
  } catch (error) {
    return sendAdminError(res, error);
  }
});

adminRoutes.patch("/users/:userId/role", requireAdmin, async (req, res) => {
  try {
    const result = await setUserRole({
      userId: req.params.userId,
      role: req.body?.role,
    });

    return res.json(result);
  } catch (error) {
    return sendAdminError(res, error);
  }
});

adminRoutes.get("/transactions", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getAdminTransactions());
  } catch (error) {
    return sendAdminError(res, error);
  }
});
