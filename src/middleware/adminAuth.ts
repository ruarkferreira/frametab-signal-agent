import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * Simple admin authentication middleware.
 * Expects a Bearer JWT in the Authorization header.
 * The JWT must be signed with the ADMIN_JWT_SECRET env var.
 *
 * For development, set ADMIN_BYPASS=true to skip auth entirely.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ADMIN_BYPASS === "true") {
    (req as any).adminId = "dev-bypass";
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.ADMIN_JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: "ADMIN_JWT_SECRET not configured" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as { id?: string; sub?: string };
    (req as any).adminId = payload.id ?? payload.sub ?? "admin";
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
