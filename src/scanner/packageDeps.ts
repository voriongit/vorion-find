import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Walks cwd looking for package.json and pyproject.toml. Reports the set of
 * declared deps (names + version ranges). Does NOT try to classify which are
 * AI-related — server does that.
 *
 * Quick depth: only cwd's root files.
 * Standard+ depth: also scan one level down (monorepos).
 */
export const scanPackageDeps: Scanner = async (ctx: ScanContext): Promise<number> => {
  const hits: Evidence[] = [];
  const roots = [ctx.cwd];

  if (ctx.depth !== "quick") {
    // shallow: 1 level of children (e.g. monorepo packages/*, apps/*)
    try {
      const children = fs.readdirSync(ctx.cwd, { withFileTypes: true });
      for (const d of children) {
        if (!d.isDirectory()) continue;
        if (d.name.startsWith(".") || d.name === "node_modules") continue;
        roots.push(path.join(ctx.cwd, d.name));
        // one more level for common monorepo shapes
        if (["packages", "apps"].includes(d.name)) {
          try {
            const grand = fs.readdirSync(path.join(ctx.cwd, d.name), { withFileTypes: true });
            for (const g of grand) {
              if (g.isDirectory() && !g.name.startsWith(".")) {
                roots.push(path.join(ctx.cwd, d.name, g.name));
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const root of roots) {
    if (Date.now() > ctx.deadline) break;
    const pkg = readJson(path.join(root, "package.json"));
    if (pkg) {
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
      };
      if (Object.keys(deps).length > 0) {
        const content = JSON.stringify(deps);
        hits.push({
          kind: "package-deps",
          path: path.join(root, "package.json"),
          content,
          contentHash: sha256(content),
          meta: {
            name: pkg.name,
            version: pkg.version,
            depCount: Object.keys(deps).length,
          },
        });
      }
    }

    const py = readText(path.join(root, "pyproject.toml"));
    if (py) {
      hits.push({
        kind: "package-deps",
        path: path.join(root, "pyproject.toml"),
        content: py.slice(0, 4096),
        contentHash: sha256(py),
        meta: { format: "pyproject" },
      });
    }

    const req = readText(path.join(root, "requirements.txt"));
    if (req) {
      hits.push({
        kind: "package-deps",
        path: path.join(root, "requirements.txt"),
        content: req.slice(0, 4096),
        contentHash: sha256(req),
        meta: { format: "requirements.txt" },
      });
    }
  }

  if (hits.length > 0) {
    await ctx.emit(hits);
    ctx.log(`package-deps: ${hits.length}`);
  }
  return hits.length;
};

function readJson(p: string): any | null {
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
