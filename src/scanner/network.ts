import { execFileSync } from "node:child_process";
import { SUBPROCESS_TIMEOUT_MS } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Snapshots current listening TCP/UDP ports. Windows: `netstat -ano`.
 * Unix: `ss -tulnp` falling back to `netstat -anp`.
 * Time-bounded; silent on failure.
 */
export const scanNetwork: Scanner = async (ctx: ScanContext): Promise<number> => {
  if (Date.now() > ctx.deadline) return 0;
  let content: string | null = null;
  let tool = "netstat";
  if (process.platform === "win32") {
    content = runSafe("netstat", ["-ano"]);
  } else {
    content = runSafe("ss", ["-tulnH"]);
    if (content) {
      tool = "ss";
    } else {
      content = runSafe("netstat", ["-anp"]);
    }
  }
  if (!content) return 0;

  // Drop lines that aren't listening/established to keep it compact
  const lines = content.split(/\r?\n/).filter((l) => {
    if (!l.trim()) return false;
    if (process.platform === "win32") {
      return /LISTENING|ESTABLISHED/i.test(l);
    }
    return /LISTEN|ESTAB|UNCONN/i.test(l) || tool === "ss";
  });
  const trimmed = lines.slice(0, 500).join("\n");

  const evidence: Evidence = {
    kind: "network-connections",
    path: tool,
    content: trimmed,
    contentHash: sha256(content),
    meta: { platform: process.platform, tool, lineCount: lines.length },
  };
  await ctx.emit([evidence]);
  ctx.log(`network-connections: ${lines.length} lines`);
  return 1;
};

function runSafe(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: SUBPROCESS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}
