import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { deviceIdPath, stateDir } from "./config.js";

/**
 * Returns a persistent device UUID. Creates one and persists it to
 * ~/.vorion-find/device-id the first time it's called. Cross-platform.
 */
export function getOrCreateDeviceId(): string {
  const dir = stateDir();
  const file = deviceIdPath();

  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (isUuidV4(existing)) return existing;
    // fall through: bad file, rewrite
  } catch {
    // not found, create below
  }

  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id + "\n", { mode: 0o600 });
  // Best-effort to lock down perms even on Windows (chmod is a no-op there)
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return id;
}

function isUuidV4(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
