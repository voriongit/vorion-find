import type { Depth } from "../config.js";

/**
 * Evidence kinds per find-contract.md. The server (not the CLI) classifies
 * each evidence item into a DiscoveryResult.
 */
export type EvidenceKind =
  | "package-deps"
  | "env-keys"
  | "mcp-configs"
  | "source-imports"
  | "installed-packages"
  | "running-processes"
  | "docker-containers"
  | "network-connections";

export interface Evidence {
  kind: EvidenceKind;
  path: string;
  content: string;
  contentHash: string;
  meta?: Record<string, unknown>;
}

export interface ScanContext {
  depth: Depth;
  cwd: string;
  startedAt: number;
  /** Soft deadline (epoch ms). Scanners should check this and bail out. */
  deadline: number;
  /** Emit a batch of evidence as it's collected (caller handles network). */
  emit: (batch: Evidence[]) => Promise<void>;
  /** Push a progress line to the terminal (throttled, not log-spam). */
  log: (msg: string) => void;
}

export type Scanner = (ctx: ScanContext) => Promise<number>;
