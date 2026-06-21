import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const jwtSecret = process.env.JWT_SECRET;

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) {
      return res.status(401).json({ message: "Invalid token subject" });
    }

    const { rows } = await pool.query(
      `
      SELECT user_id AS "userId",
             email,
             role,
             is_frozen AS "isFrozen"
      FROM users
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Frozen users are denied even with an otherwise valid JWT. Checked here so
    // every authenticated route (and requireAdmin, which wraps this) is covered
    // without per-route changes.
    if (user.isFrozen) {
      return res.status(403).json({ message: "User account is frozen" });
    }

    req.user = { id: userId, userId };
    req.auth = {
      user: {
        userId,
        email: user.email,
        role: user.role,
        isFrozen: Boolean(user.isFrozen),
      },
    };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
