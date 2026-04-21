import { execFileSync } from "node:child_process";
import { SUBPROCESS_TIMEOUT_MS } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Lists running processes. Windows uses `tasklist`; unix uses `ps`.
 * Time-bounded; silent failure if the command is missing or the sandbox
 * blocks it — we never crash the scan.
 */
export const scanProcesses: Scanner = async (ctx: ScanContext): Promise<number> => {
  if (Date.now() > ctx.deadline) return 0;
  let content: string | null = null;
  try {
    if (process.platform === "win32") {
      content = runSafe("tasklist", ["/FO", "CSV", "/NH"]);
    } else {
      content = runSafe("ps", ["-axo", "pid,ppid,comm,args"]);
    }
  } catch {
    content = null;
  }
  if (!content) return 0;

  // Trim to a reasonable cap (server trims to 8 KB, so we give it more to work with)
  const trimmed = content.length > 32 * 1024 ? content.slice(0, 32 * 1024) : content;
  const evidence: Evidence = {
    kind: "running-processes",
    path: process.platform === "win32" ? "tasklist" : "ps",
    content: trimmed,
    contentHash: sha256(content),
    meta: { platform: process.platform },
  };
  await ctx.emit([evidence]);
  ctx.log(`running-processes: sampled`);
  return 1;
};

function runSafe(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: SUBPROCESS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return out;
  } catch {
    return null;
  }
}
