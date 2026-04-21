import os from "node:os";
import path from "node:path";

export const CLI_VERSION = "0.1.0";
export const CLIENT_KIND = "cli";

export const DEFAULT_ENDPOINT = "https://aurais.net";

export const MAX_EVIDENCE_BYTES = 8 * 1024; // 8 KB per contract
export const MAX_BATCH_SIZE = 100;

// Session TTL is 15 min server-side; we give ourselves a safety margin
export const SESSION_TTL_MS = 15 * 60 * 1000;

// Depth time budgets (soft caps) in ms
export const DEPTH_BUDGETS = {
  quick: 2_000,
  standard: 10_000,
  deep: 30_000,
  fulltilt: 120_000,
} as const;

export type Depth = keyof typeof DEPTH_BUDGETS;

// Per-subprocess wall-clock cap (docker, ps, netstat)
export const SUBPROCESS_TIMEOUT_MS = 3_000;

// Per-file read cap for scanning source imports
export const MAX_SOURCE_READ_BYTES = 5 * 1024; // 5 KB per contract

// State dir lives under the user's home: ~/.vorion-find
export function stateDir(): string {
  return path.join(os.homedir(), ".vorion-find");
}

export function deviceIdPath(): string {
  return path.join(stateDir(), "device-id");
}

// MCP config paths per contract
export function mcpConfigPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const paths: string[] = [
    path.join(home, ".claude", "mcp.json"),
    path.join(home, ".cursor", "mcp.json"),
  ];
  if (platform === "darwin") {
    paths.push(
      path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      path.join(home, "Library", "Application Support", "Cursor", "User", "settings.json"),
    );
  } else if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    paths.push(
      path.join(appData, "Claude", "claude_desktop_config.json"),
      path.join(appData, "Cursor", "User", "settings.json"),
    );
  } else {
    // linux and other *nix
    paths.push(
      path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      path.join(home, ".config", "Cursor", "User", "settings.json"),
    );
  }
  return paths;
}

// Known AI-related env var key prefixes/names we report as ENV keys.
// We only report the KEY names, never the values.
export const AI_ENV_KEY_PATTERNS: RegExp[] = [
  /^OPENAI(_|$)/i,
  /^ANTHROPIC(_|$)/i,
  /^CLAUDE(_|$)/i,
  /^GOOGLE_(GENAI|API_KEY|PALM|GEMINI)/i,
  /^GEMINI(_|$)/i,
  /^AZURE_OPENAI(_|$)/i,
  /^COHERE(_|$)/i,
  /^MISTRAL(_|$)/i,
  /^HUGGINGFACE(_|$)/i,
  /^HF_(TOKEN|API)/i,
  /^REPLICATE(_|$)/i,
  /^PERPLEXITY(_|$)/i,
  /^GROQ(_|$)/i,
  /^TOGETHER(_|$)/i,
  /^XAI(_|$)/i,
  /^DEEPSEEK(_|$)/i,
  /^OLLAMA(_|$)/i,
  /^LANGCHAIN(_|$)/i,
  /^LANGSMITH(_|$)/i,
  /^LANGFUSE(_|$)/i,
  /^LLAMA(_|$)/i,
  /^PINECONE(_|$)/i,
  /^WEAVIATE(_|$)/i,
  /^CHROMA(_|$)/i,
  /^VORION(_|$)/i,
  /^AURAIS(_|$)/i,
  /^COGNIGATE(_|$)/i,
];

// File globs we consider "source" for import scanning (standard+ depth)
export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
