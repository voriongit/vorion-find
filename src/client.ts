import { CLI_VERSION, CLIENT_KIND, MAX_BATCH_SIZE, MAX_EVIDENCE_BYTES } from "./config.js";
import type { Evidence } from "./scanner/types.js";

export interface PairClaimResponse {
  sessionId: string;
  pairToken: string;
  pairCode?: string;
  expiresAt?: string;
  pushUrl: string;
  doneUrl: string;
  streamUrl?: string;
}

export interface PairSession {
  sessionId: string;
  pairToken: string;
  pushUrl: string;
  doneUrl: string;
  endpoint: string;
}

export class PairAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairAuthError";
  }
}

export class PairHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "PairHttpError";
    this.status = status;
    this.body = body;
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": `vorion-find/${CLI_VERSION}`,
  Accept: "application/json",
};

/**
 * Claim a fresh pair token + sessionId from the server.
 * Used when CLI runs with `--pair=NEW`.
 */
export async function claimPair(
  endpoint: string,
  deviceId: string,
): Promise<PairClaimResponse> {
  const url = joinUrl(endpoint, "/api/pair/claim");
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      deviceId,
      clientKind: CLIENT_KIND,
      clientVersion: CLI_VERSION,
    }),
  });
  if (!res.ok) {
    const body = await safeText(res);
    throw new PairHttpError(res.status, body, `pair/claim failed: ${res.status}`);
  }
  const json = (await res.json()) as PairClaimResponse;
  if (!json.sessionId || !json.pairToken) {
    throw new Error("pair/claim response missing sessionId or pairToken");
  }
  return json;
}

/**
 * Parse a browser-minted pair token of the form `pair_<base64url>`.
 * Contract says we treat it as opaque, so we don't crack the payload.
 * Caller must separately know the sessionId (from claimPair OR from a browser
 * handoff page). For a raw token-only invocation, we require the sessionId
 * to be discoverable via a lightweight introspect call.
 */
export function parsePairToken(tokenOrNew: string): string | null {
  if (!tokenOrNew) return null;
  if (tokenOrNew === "NEW") return null;
  if (!tokenOrNew.startsWith("pair_")) return null;
  return tokenOrNew;
}

/**
 * Push a batch of evidence. Automatically splits at MAX_BATCH_SIZE and
 * trims every item's content to MAX_EVIDENCE_BYTES.
 *
 * Returns the total number of items acked.
 * Throws PairAuthError on 401 so the caller can stop the scan.
 */
export async function pushBatch(
  session: PairSession,
  items: Evidence[],
): Promise<number> {
  if (items.length === 0) return 0;
  let acked = 0;
  const url = joinUrl(session.endpoint, session.pushUrl);

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const chunk = items.slice(i, i + MAX_BATCH_SIZE).map(trimEvidence);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${session.pairToken}`,
      },
      body: JSON.stringify({ batch: chunk }),
    });
    if (res.status === 401) {
      throw new PairAuthError("Pair token rejected (401) — session expired, please re-pair.");
    }
    if (!res.ok) {
      const body = await safeText(res);
      throw new PairHttpError(res.status, body, `findings/push failed: ${res.status}`);
    }
    acked += chunk.length;
  }
  return acked;
}

/**
 * Signal scan completion. Server emits summary + done on the SSE channel
 * and invalidates the pair token.
 */
export async function sendDone(
  session: PairSession,
  reason: "completed" | "aborted",
  totalScanned: number,
): Promise<void> {
  const url = joinUrl(session.endpoint, session.doneUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${session.pairToken}`,
    },
    body: JSON.stringify({ reason, totalScanned }),
  });
  if (res.status === 401) {
    // Already invalidated or expired; treat as non-fatal.
    return;
  }
  if (!res.ok) {
    const body = await safeText(res);
    throw new PairHttpError(res.status, body, `findings/done failed: ${res.status}`);
  }
}

// ---- helpers ----

function joinUrl(base: string, pathPart: string): string {
  if (/^https?:\/\//i.test(pathPart)) return pathPart;
  const b = base.replace(/\/+$/, "");
  const p = pathPart.startsWith("/") ? pathPart : "/" + pathPart;
  return b + p;
}

function trimEvidence(e: Evidence): Evidence {
  const content = e.content ?? "";
  if (Buffer.byteLength(content, "utf8") <= MAX_EVIDENCE_BYTES) return e;
  // Trim by byte length, cautiously (may leave a mangled trailing char; server re-trims)
  const buf = Buffer.from(content, "utf8").subarray(0, MAX_EVIDENCE_BYTES);
  return { ...e, content: buf.toString("utf8") };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
