import jwt from "jsonwebtoken";

// A missing secret used to fall back to a public constant, which would have
// meant anyone could forge a token against a deployed instance. Fail at boot
// instead — a deploy that can't authenticate should never start.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production");
}

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const TOKEN_TTL = "12h";

export function issueGuestToken({ userId, name, roomId }) {
  return jwt.sign({ sub: userId, name, roomId }, SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
