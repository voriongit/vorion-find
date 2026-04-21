import process from "node:process";
import { exec } from "node:child_process";
import { parseArgs, helpText } from "./args.js";
import { claimPair, parsePairToken, pushBatch, sendDone, PairAuthError, PairHttpError } from "./client.js";
import type { PairSession } from "./client.js";
import { CLI_VERSION } from "./config.js";
import { getOrCreateDeviceId } from "./device-id.js";
import { runScan } from "./scanner/index.js";
import type { Evidence } from "./scanner/types.js";

/**
 * Open a URL in the user's default browser. Best-effort: if nothing works,
 * just log the URL so the user can copy it.
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  // Single-quote the URL to defeat `&` being interpreted by cmd.exe.
  const cmd =
    platform === "win32"
      ? `cmd /c start "" "${url.replace(/"/g, '\\"')}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  try {
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        process.stderr.write(
          `(couldn't auto-open browser — visit manually: ${url})\n`,
        );
      }
    });
  } catch {
    process.stderr.write(`(couldn't auto-open browser — visit manually: ${url})\n`);
  }
}

function printPairBanner(code: string, url: string): void {
  const line = "=".repeat(58);
  process.stderr.write(`\n${line}\n`);
  process.stderr.write(`  PAIR CODE:  ${code}\n`);
  process.stderr.write(`  VERIFY:     your browser should show the same code.\n`);
  process.stderr.write(`  WATCH:      ${url}\n`);
  process.stderr.write(`${line}\n\n`);
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${errToString(err)}\n\n`);
    process.stderr.write(helpText(CLI_VERSION));
    return 2;
  }

  if (args.help) {
    process.stdout.write(helpText(CLI_VERSION));
    return 0;
  }
  if (args.version) {
    process.stdout.write(`vorion-find ${CLI_VERSION}\n`);
    return 0;
  }

  const deviceId = getOrCreateDeviceId();
  const endpoint = args.endpoint.replace(/\/+$/, "");

  // No --pair? Enter auto-browser mode: mint a session, open the browser
  // to /pair so the user watches live, and start scanning. This is the
  // double-click-the-exe path — zero terminal-arg knowledge required.
  const autoBrowserMode = !args.pair && !args.dryRun;

  // Resolve session (unless dry-run)
  let session: PairSession | null = null;
  let autoBrowserCode: string | null = null;
  if (!args.dryRun) {
    try {
      if (autoBrowserMode) {
        const claim = await claimPair(endpoint, deviceId);
        autoBrowserCode = claim.pairCode ?? null;
        session = {
          sessionId: claim.sessionId,
          pairToken: claim.pairToken,
          pushUrl: claim.pushUrl,
          doneUrl: claim.doneUrl,
          endpoint,
        };
        const watchUrl = `${endpoint}/pair?s=${claim.sessionId}${
          claim.pairCode ? `&code=${encodeURIComponent(claim.pairCode)}` : ""
        }&depth=${args.depth}`;
        printPairBanner(claim.pairCode ?? "(no code)", watchUrl);
        openBrowser(watchUrl);
      } else {
        session = await resolveSession(args.pair, endpoint, deviceId);
      }
    } catch (err) {
      process.stderr.write(`error: pair claim failed: ${errToString(err)}\n`);
      process.stderr.write(
        `hint: visit ${endpoint}/find in your browser to mint a token, then re-run with --pair=<token>\n`,
      );
      return 1;
    }
  }

  // Scan
  const collected: Evidence[] = [];
  let pushedCount = 0;
  let pushFailed = false;
  let authExpired = false;

  const summary = {
    byKind: new Map<string, number>(),
    bytes: 0,
  };

  const emit = async (batch: Evidence[]): Promise<void> => {
    for (const e of batch) {
      collected.push(e);
      summary.byKind.set(e.kind, (summary.byKind.get(e.kind) ?? 0) + 1);
      summary.bytes += Buffer.byteLength(e.content, "utf8");
      if (args.stdout) {
        process.stdout.write(JSON.stringify(e) + "\n");
      }
    }
    if (session && !pushFailed && !authExpired) {
      try {
        const n = await pushBatch(session, batch);
        pushedCount += n;
      } catch (err) {
        if (err instanceof PairAuthError) {
          authExpired = true;
          process.stderr.write(
            `\n! pair token expired mid-scan — stopping push. Collected findings printed at end.\n`,
          );
        } else {
          pushFailed = true;
          process.stderr.write(`\n! push failed (${errToString(err)}); will dump NDJSON at end.\n`);
        }
      }
    }
  };

  printBanner(args.depth, args.dryRun, session, endpoint);

  const result = await runScan({
    depth: args.depth,
    cwd: args.cwd,
    emit,
    log: (msg) => progress(msg),
  });

  // Done
  if (session && !authExpired) {
    try {
      await sendDone(session, "completed", result.totalScanned);
    } catch (err) {
      process.stderr.write(`! findings/done failed: ${errToString(err)} (non-fatal)\n`);
    }
  }

  printSummary({
    collected: collected.length,
    pushed: pushedCount,
    byKind: summary.byKind,
    bytes: summary.bytes,
    elapsedMs: result.elapsedMs,
    dryRun: args.dryRun,
    pushFailed,
    authExpired,
    session,
    endpoint,
    autoBrowser: autoBrowserMode,
  });

  // If we failed to push, dump NDJSON so user doesn't lose work
  if (pushFailed || authExpired) {
    process.stderr.write(
      `\n--- Findings NDJSON (${collected.length} items, pipe to a file to save) ---\n`,
    );
    for (const e of collected) {
      process.stdout.write(JSON.stringify(e) + "\n");
    }
  }

  return pushFailed ? 1 : 0;
}

async function resolveSession(
  pair: string,
  endpoint: string,
  deviceId: string,
): Promise<PairSession> {
  if (pair === "NEW" || !pair) {
    const claim = await claimPair(endpoint, deviceId);
    process.stderr.write(
      `pair minted: ${claim.pairCode ?? "(no code)"} — open ${endpoint}/find?s=${claim.sessionId} to watch\n`,
    );
    return {
      sessionId: claim.sessionId,
      pairToken: claim.pairToken,
      pushUrl: claim.pushUrl,
      doneUrl: claim.doneUrl,
      endpoint,
    };
  }
  // The browser hands off `<sessionId>:pair_<token>` in one string — split
  // first, THEN validate the token half. This is the contract per
  // aurais/docs/find-contract.md: the sessionId is in the URL path, the
  // pair token is the Bearer credential.
  const [maybeSession, maybeToken] = pair.includes(":")
    ? pair.split(":", 2)
    : ["", pair];
  const sessionId = maybeSession || "";
  const tokenCandidate = maybeToken || pair;
  const actualToken = parsePairToken(tokenCandidate);
  if (!actualToken) {
    throw new Error(
      `invalid --pair value: expected "NEW", a pair_<token> string, or ` +
        `<sessionId>:pair_<token> (as displayed by aurais.net/find)`,
    );
  }

  if (!sessionId) {
    throw new Error(
      `--pair token alone cannot resolve the sessionId. ` +
        `Use --pair=NEW (CLI mints session), or have the browser copy the full ` +
        `"<sessionId>:<pairToken>" string from aurais.net/find.`,
    );
  }

  return {
    sessionId,
    pairToken: actualToken,
    pushUrl: `/api/findings/${sessionId}/push`,
    doneUrl: `/api/findings/${sessionId}/done`,
    endpoint,
  };
}

let lastProgressAt = 0;
function progress(msg: string): void {
  // throttle to avoid log spam
  const now = Date.now();
  if (now - lastProgressAt < 150) return;
  lastProgressAt = now;
  process.stderr.write(`  · ${msg}\n`);
}

function printBanner(
  depth: string,
  dryRun: boolean,
  session: PairSession | null,
  endpoint: string,
): void {
  const parts = [
    `vorion-find ${CLI_VERSION}`,
    `depth=${depth}`,
    dryRun ? "DRY-RUN" : `endpoint=${endpoint}`,
    session ? `session=${session.sessionId}` : "",
  ].filter(Boolean);
  process.stderr.write(parts.join("  ") + "\n");
  process.stderr.write("scanning...\n");
}

interface SummaryArgs {
  collected: number;
  pushed: number;
  byKind: Map<string, number>;
  bytes: number;
  elapsedMs: number;
  dryRun: boolean;
  pushFailed: boolean;
  authExpired: boolean;
  session: PairSession | null;
  endpoint: string;
  autoBrowser: boolean;
}

function printSummary(s: SummaryArgs): void {
  process.stderr.write("\n");
  const kinds = [...s.byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `    ${k.padEnd(22)} ${n}`)
    .join("\n");

  process.stderr.write(`scan complete in ${s.elapsedMs} ms\n`);
  process.stderr.write(`  findings:  ${s.collected}\n`);
  if (!s.dryRun) {
    process.stderr.write(`  uploaded:  ${s.pushed}\n`);
  }
  process.stderr.write(`  bytes:     ${s.bytes}\n`);
  if (kinds) {
    process.stderr.write(`  by kind:\n${kinds}\n`);
  }

  if (s.dryRun) {
    process.stderr.write(`\n(dry run — nothing was posted)\n`);
    return;
  }

  if (s.authExpired) {
    process.stderr.write(
      `\n! session expired. Re-pair at ${s.endpoint}/find and rerun with the new token.\n`,
    );
    return;
  }
  if (s.pushFailed) {
    process.stderr.write(
      `\n! upload failed. Findings were printed as NDJSON below so you can retry later.\n`,
    );
    return;
  }
  if (s.session) {
    const browserUrl = s.autoBrowser
      ? `${s.endpoint}/pair?s=${s.session.sessionId}`
      : `${s.endpoint}/find?s=${s.session.sessionId}`;
    process.stderr.write(`\nView in browser: ${browserUrl}\n`);
    if (s.autoBrowser) {
      process.stderr.write(
        `You can close this window — the browser has your results.\n`,
      );
    }
  }
}

function errToString(err: unknown): string {
  if (err instanceof PairHttpError) return `${err.status} ${err.body.slice(0, 200)}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${errToString(err)}\n`);
    process.exit(1);
  },
);
