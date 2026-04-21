import type { Depth } from "./config.js";
import { DEFAULT_ENDPOINT } from "./config.js";

export interface ParsedArgs {
  pair: string; // "NEW" or a pair_* token
  depth: Depth;
  endpoint: string;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  cwd: string;
  /** If true, emit NDJSON to stdout instead of posting. */
  stdout: boolean;
}

const VALID_DEPTHS: Depth[] = ["quick", "standard", "deep", "fulltilt"];

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    pair: "",
    depth: "standard",
    endpoint: DEFAULT_ENDPOINT,
    dryRun: false,
    help: false,
    version: false,
    cwd: process.cwd(),
    stdout: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--version" || a === "-v") {
      args.version = true;
    } else if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "--stdout") {
      args.stdout = true;
    } else if (a.startsWith("--pair=")) {
      args.pair = a.slice("--pair=".length);
    } else if (a === "--pair") {
      args.pair = argv[++i] ?? "";
    } else if (a.startsWith("--depth=")) {
      const v = a.slice("--depth=".length) as Depth;
      args.depth = coerceDepth(v);
    } else if (a === "--depth") {
      args.depth = coerceDepth(argv[++i] as Depth);
    } else if (a.startsWith("--endpoint=")) {
      args.endpoint = a.slice("--endpoint=".length);
    } else if (a === "--endpoint") {
      args.endpoint = argv[++i] ?? DEFAULT_ENDPOINT;
    } else if (a.startsWith("--cwd=")) {
      args.cwd = a.slice("--cwd=".length);
    } else if (a === "--cwd") {
      args.cwd = argv[++i] ?? process.cwd();
    } else if (a === "--") {
      // end of options
      break;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

function coerceDepth(v: Depth | string | undefined): Depth {
  if (!v) return "standard";
  if ((VALID_DEPTHS as readonly string[]).includes(v)) return v as Depth;
  throw new Error(`Invalid --depth "${v}". Choose one of: ${VALID_DEPTHS.join(", ")}`);
}

export function helpText(version: string): string {
  return `vorion-find ${version} — scan this device for AI agents, stream findings to aurais.net

Usage
  npx vorion-find --pair=NEW
  npx vorion-find --pair=pair_<token> [--depth=standard] [--endpoint=https://aurais.net]

Flags
  --pair=NEW | <token>    Mint a new session, OR use a token minted by the
                          browser at aurais.net/find (required unless --dry-run).
  --depth=<quick|standard|deep|fulltilt>
                          quick    (~2s)   package.json + pyproject + MCP configs
                          standard (~10s)  + .env keys, source imports, installed
                          deep     (~30s)  + running processes, docker, network
                          fulltilt         no time budget
                          (default: standard)
  --endpoint=<url>        Aurais API base URL (default: https://aurais.net)
  --cwd=<path>            Directory to scan (default: current working dir)
  --dry-run               Scan but do not POST; print a summary only.
  --stdout                Print every evidence item as NDJSON on stdout AND
                          post it — useful for debugging.
  --help, -h              Show this message.
  --version, -v           Print version and exit.

What it sends
  See README.md "What it sends" section, or:
  https://github.com/voriongit/vorion-find#what-it-sends

Device identity
  A random UUID v4 lives at ~/.vorion-find/device-id and is reused across
  scans so aurais can group them under one device card.
`;
}
