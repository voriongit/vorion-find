import fs from "node:fs";
import path from "node:path";
import { AI_ENV_KEY_PATTERNS } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Scans .env / .env.* files in cwd and nearby directories for AI-related KEY
 * NAMES only. Values are never included — we only report which keys exist so
 * the server can classify which providers are configured.
 */
export const scanEnvKeys: Scanner = async (ctx: ScanContext): Promise<number> => {
  const hits: Evidence[] = [];
  const candidates = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".env.test",
  ];

  for (const name of candidates) {
    if (Date.now() > ctx.deadline) break;
    const full = path.join(ctx.cwd, name);
    const keys = extractAiKeys(full);
    if (keys.length === 0) continue;
    const content = keys.join("\n");
    hits.push({
      kind: "env-keys",
      path: full,
      content,
      contentHash: sha256(content),
      meta: { count: keys.length, file: name },
    });
  }

  // Also: process.env at runtime (no values, just matched keys)
  const procKeys = Object.keys(process.env).filter((k) =>
    AI_ENV_KEY_PATTERNS.some((re) => re.test(k)),
  );
  if (procKeys.length > 0) {
    const content = procKeys.sort().join("\n");
    hits.push({
      kind: "env-keys",
      path: "process.env",
      content,
      contentHash: sha256(content),
      meta: { count: procKeys.length, source: "process.env" },
    });
  }

  if (hits.length > 0) {
    await ctx.emit(hits);
    ctx.log(`env-keys: ${hits.length}`);
  }
  return hits.length;
};

function extractAiKeys(file: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const keys: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    if (AI_ENV_KEY_PATTERNS.some((re) => re.test(key))) keys.push(key);
  }
  return keys;
}
