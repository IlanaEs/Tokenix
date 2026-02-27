import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) {
      return res.status(401).json({ message: "Invalid token subject" });
    }

    req.user = { id: userId, userId };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
