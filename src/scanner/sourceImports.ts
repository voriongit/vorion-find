import fs from "node:fs";
import path from "node:path";
import { MAX_SOURCE_READ_BYTES, SOURCE_EXTENSIONS } from "../config.js";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Walks src/ (or ctx.cwd fallback) breadth-first, reads the first
 * MAX_SOURCE_READ_BYTES of each file, and extracts import / require
 * statements. Server classifies which imports indicate AI SDK usage.
 *
 * Standard depth walks up to ~200 files; deep / fulltilt walks more.
 */
export const scanSourceImports: Scanner = async (ctx: ScanContext): Promise<number> => {
  const fileCap =
    ctx.depth === "standard" ? 200 : ctx.depth === "deep" ? 800 : 2000;

  const hits: Evidence[] = [];
  const roots = pickRoots(ctx.cwd);
  const queue: string[] = [...roots];
  const seen = new Set<string>();
  let visited = 0;

  while (queue.length > 0 && visited < fileCap) {
    if (Date.now() > ctx.deadline) break;
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (visited >= fileCap) break;
      if (Date.now() > ctx.deadline) break;
      if (e.name.startsWith(".")) continue;
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      if (e.name === "__pycache__" || e.name === ".venv" || e.name === "venv") continue;

      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      visited++;
      const imports = extractImports(full);
      if (imports.length === 0) continue;
      const content = imports.join("\n");
      hits.push({
        kind: "source-imports",
        path: full,
        content,
        contentHash: sha256(content),
        meta: { lang: ext.replace(".", ""), importCount: imports.length },
      });

      // Emit in sub-batches so the server sees progress early
      if (hits.length >= 50) {
        await ctx.emit(hits.splice(0, hits.length));
      }
    }
  }

  if (hits.length > 0) {
    await ctx.emit(hits);
  }
  ctx.log(`source-imports: ${visited} files scanned`);
  return visited;
};

function pickRoots(cwd: string): string[] {
  const candidates = ["src", "app", "lib", "pages", "server", "scripts"];
  const roots: string[] = [];
  for (const c of candidates) {
    const full = path.join(cwd, c);
    try {
      if (fs.statSync(full).isDirectory()) roots.push(full);
    } catch {
      /* ignore */
    }
  }
  if (roots.length === 0) roots.push(cwd); // fall back to cwd root
  return roots;
}

function extractImports(file: string): string[] {
  let buf: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      buf = Buffer.alloc(MAX_SOURCE_READ_BYTES);
      const bytes = fs.readSync(fd, buf, 0, MAX_SOURCE_READ_BYTES, 0);
      buf = buf.subarray(0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const text = buf.toString("utf8");
  const out: string[] = [];

  // JS/TS: import ... from "x" | import("x") | require("x")
  const jsRe =
    /(?:^|\s)(?:import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"]\s*\))|(?:import\(\s*['"]([^'"]+)['"]\s*\))/gm;
  let m: RegExpExecArray | null;
  while ((m = jsRe.exec(text)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec && spec.length < 200) out.push(`import ${spec}`);
    if (out.length > 40) break;
  }

  // Python: import x / from x import y
  const pyRe = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  while ((m = pyRe.exec(text)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) out.push(`py ${spec}`);
    if (out.length > 40) break;
  }

  // De-dup, preserve order
  return Array.from(new Set(out));
}
