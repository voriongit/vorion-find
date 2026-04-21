import type { Depth } from "../config.js";
import { DEPTH_BUDGETS } from "../config.js";
import { scanDocker } from "./docker.js";
import { scanEnvKeys } from "./envKeys.js";
import { scanInstalledPackages } from "./installedPackages.js";
import { scanMcpConfigs } from "./mcpConfigs.js";
import { scanNetwork } from "./network.js";
import { scanPackageDeps } from "./packageDeps.js";
import { scanProcesses } from "./processes.js";
import { scanSourceImports } from "./sourceImports.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

export interface RunScanArgs {
  depth: Depth;
  cwd: string;
  emit: (batch: Evidence[]) => Promise<void>;
  log: (msg: string) => void;
}

export interface RunScanResult {
  totalScanned: number;
  elapsedMs: number;
}

/**
 * Orchestrates each scanner in depth-appropriate order. Each scanner is
 * individually try/caught so one failure can't abort the whole scan.
 */
export async function runScan(args: RunScanArgs): Promise<RunScanResult> {
  const startedAt = Date.now();
  const deadline = startedAt + DEPTH_BUDGETS[args.depth];

  const ctx: ScanContext = {
    depth: args.depth,
    cwd: args.cwd,
    startedAt,
    deadline,
    emit: args.emit,
    log: args.log,
  };

  const scanners = scannerListForDepth(args.depth);
  let total = 0;
  for (const [name, fn] of scanners) {
    if (Date.now() > deadline && args.depth !== "fulltilt") break;
    try {
      const n = await fn(ctx);
      total += n;
    } catch (err) {
      ctx.log(`scanner "${name}" failed: ${errToString(err)}`);
    }
  }
  return { totalScanned: total, elapsedMs: Date.now() - startedAt };
}

function scannerListForDepth(depth: Depth): Array<[string, Scanner]> {
  const base: Array<[string, Scanner]> = [
    ["package-deps", scanPackageDeps],
    ["mcp-configs", scanMcpConfigs],
  ];
  if (depth === "quick") return base;

  const standardExtra: Array<[string, Scanner]> = [
    ["env-keys", scanEnvKeys],
    ["source-imports", scanSourceImports],
    ["installed-packages", scanInstalledPackages],
  ];
  if (depth === "standard") return [...base, ...standardExtra];

  const deepExtra: Array<[string, Scanner]> = [
    ["running-processes", scanProcesses],
    ["docker-containers", scanDocker],
    ["network-connections", scanNetwork],
  ];
  // deep and fulltilt run the full pipeline; fulltilt just has no time cap
  return [...base, ...standardExtra, ...deepExtra];
}

function errToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
