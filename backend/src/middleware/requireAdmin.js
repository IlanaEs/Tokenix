import { requireAuth } from "./requireAuth.js";

export async function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.auth?.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "Admin access required" });
    }

    return next();
  });
}
