import fs from "node:fs";
import { mcpConfigPaths } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Reads every known MCP/claude_desktop/cursor config path the platform can
 * have. Sends the file content as-is (server trims to 8 KB).
 */
export const scanMcpConfigs: Scanner = async (ctx: ScanContext): Promise<number> => {
  const hits: Evidence[] = [];
  for (const p of mcpConfigPaths()) {
    if (Date.now() > ctx.deadline) break;
    let raw: string;
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    hits.push({
      kind: "mcp-configs",
      path: p,
      content: raw,
      contentHash: sha256(raw),
      meta: { bytes: Buffer.byteLength(raw, "utf8") },
    });
  }
  if (hits.length > 0) {
    await ctx.emit(hits);
    ctx.log(`mcp-configs: ${hits.length}`);
  }
  return hits.length;
};
