import { execFileSync } from "node:child_process";
import { SUBPROCESS_TIMEOUT_MS } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * If docker CLI is present, list running containers. Silent failure if
 * docker is not installed or the daemon is unreachable.
 */
export const scanDocker: Scanner = async (ctx: ScanContext): Promise<number> => {
  if (Date.now() > ctx.deadline) return 0;
  const out = runSafe("docker", ["ps", "--format", "{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"]);
  if (!out || out.trim() === "") return 0;
  const evidence: Evidence = {
    kind: "docker-containers",
    path: "docker",
    content: out,
    contentHash: sha256(out),
    meta: { lineCount: out.split("\n").filter(Boolean).length },
  };
  await ctx.emit([evidence]);
  ctx.log(`docker-containers: ${evidence.meta!.lineCount}`);
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
