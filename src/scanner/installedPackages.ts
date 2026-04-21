import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./hash.js";
import type { Evidence, ScanContext, Scanner } from "./types.js";

/**
 * Reports top-level entries under node_modules/. Does NOT descend — we only
 * want package names, not a full dependency tree.
 * Standard+ depth only.
 */
export const scanInstalledPackages: Scanner = async (ctx: ScanContext): Promise<number> => {
  const nm = path.join(ctx.cwd, "node_modules");
  let names: string[] = [];
  try {
    const entries = fs.readdirSync(nm, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === ".bin" || e.name === ".cache" || e.name === ".package-lock.json")
        continue;
      if (e.name.startsWith("@")) {
        // scoped — include one level down
        try {
          const sub = fs.readdirSync(path.join(nm, e.name), { withFileTypes: true });
          for (const s of sub) {
            if (s.isDirectory()) names.push(`${e.name}/${s.name}`);
          }
        } catch {
          /* ignore */
        }
      } else {
        names.push(e.name);
      }
    }
  } catch {
    return 0;
  }

  if (names.length === 0) return 0;
  names = names.sort();
  const content = names.join("\n");
  const evidence: Evidence = {
    kind: "installed-packages",
    path: nm,
    content,
    contentHash: sha256(content),
    meta: { count: names.length, manager: "npm" },
  };
  await ctx.emit([evidence]);
  ctx.log(`installed-packages: ${names.length}`);
  return 1;
};
