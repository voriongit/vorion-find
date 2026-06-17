# vorion-find

Scan a local device for AI agents and stream the findings to
[aurais.net](https://aurais.net), where a browser UI classifies the results
live. This CLI only collects evidence and posts it — all classification
happens server-side.

> **Read [What it does / what it sends](#what-it-does--what-it-sends) before
> you run this.** vorion-find inspects your machine and uploads the evidence
> it gathers (including the **full contents** of any AI/MCP config files it
> finds) to aurais.net by default. Use `--dry-run` first to see what *would*
> be sent without sending anything.

## Run it

The fastest way — one command, zero flags, nothing to install:

```bash
npx vorion-find
```

With **no arguments** the CLI mints a fresh session, prints a pairing code,
opens your browser to the live results page on aurais.net, and starts
scanning. This is also the "double-click to run" path: a packaged/global
binary launched with no arguments behaves the same way (auto-browser mode).
The pairing code printed in your terminal should match the one shown in the
browser before you trust the session.

Prefer to install it (optional):

```bash
npm install -g vorion-find
vorion-find            # same auto-browser flow as `npx vorion-find`
```

**Look before you send** — scan and print a summary without uploading
anything:

```bash
npx vorion-find --dry-run
```

Node.js 20+ required. This package has zero runtime dependencies.

## Pairing

A pair handshake links your scan to a live results page on aurais.net.
There are three ways to do it:

### 0. No flag — auto-browser (default, easiest)

```bash
npx vorion-find
```

With no `--pair`, the CLI mints a session for you, opens your browser to the
live page, and scans. Nothing extra to copy or paste.

### 1. Explicitly mint a session from the CLI

```bash
npx vorion-find --pair=NEW
```

The CLI prints a URL like `https://aurais.net/find?s=<sessionId>`. Open it
in your browser and you'll see findings stream in live.

### 2. Browser-mints first, then you paste into the CLI

1. Open <https://aurais.net/find> in your browser.
2. Click "Scan this device → with CLI".
3. The browser shows a pair string of the form `<sessionId>:pair_<token>`.
4. Run:

```bash
npx vorion-find --pair=<sessionId>:pair_<token>
```

Findings stream to the browser page you already have open.

## Flags

| Flag | Default | Notes |
| --- | --- | --- |
| `--pair=NEW` or `--pair=<sid>:<token>` | (omit for auto-browser) | Pair handshake. Omit it entirely to use auto-browser mode (mints a session and opens your browser). |
| `--depth=quick\|standard\|deep\|fulltilt` | `standard` | See depths below. |
| `--endpoint=<url>` | `https://aurais.net` | Override for local/staging. |
| `--cwd=<path>` | process cwd | Directory to scan. |
| `--dry-run` | off | Scan without posting; summary only. |
| `--stdout` | off | Also print every finding as NDJSON on stdout. |
| `--help`, `--version` | | |

## Depths

| Depth | Target time | What it scans |
| --- | --- | --- |
| `quick` | ~2 s | `package.json`, `pyproject.toml`, `requirements.txt`, known MCP config paths |
| `standard` | ~10 s | everything quick does, plus `.env` key names (no values), source file imports (first 5 KB of each), top-level `node_modules/` entries |
| `deep` | ~30 s | everything standard does, plus running processes, Docker containers (if docker CLI is on PATH), and listening network ports |
| `fulltilt` | no budget | same scanners as deep, but no time cap — walks more source files |

Each scanner has a per-subprocess timeout (3 s) so a hung `docker` or `ss`
command can't stall the whole scan.

## What it does / what it sends

**What it does:** vorion-find reads files and (at `deep`+ depth) runs a few
read-only system commands on your machine to find evidence that AI agents,
SDKs, or MCP servers are installed or configured. It does **not** modify
anything on your system. Unless you pass `--dry-run`, it then **uploads** the
evidence it collected to the endpoint (default `https://aurais.net`) over
HTTPS, batch by batch, as it scans. The server — not the CLI — classifies the
evidence into results that show up in your browser.

**Where it goes:** every finding is POSTed to the `--endpoint` (default
`https://aurais.net`), authenticated with the per-session pair token. A
persistent random device id (a UUID stored at `~/.vorion-find/device-id`) is
sent with the pair claim so aurais can group repeat scans under one device
card. No other account or login is involved.

Every finding is an evidence object:

```json
{
  "kind": "package-deps",
  "path": "/abs/path/to/package.json",
  "content": "<trimmed to 8 KB>",
  "contentHash": "<sha256 of original content>",
  "meta": { "optional": "context" }
}
```

The `kind` is one of:

- `package-deps` — declared dependency names + version ranges from a `package.json` (incl. dev/peer/optional deps), or the first ~4 KB of `pyproject.toml` / `requirements.txt`.
- `env-keys` — the **names only** (never the values) of env vars matching AI-related prefixes (`OPENAI_*`, `ANTHROPIC_*`, `LANGCHAIN_*`, `GOOGLE_GENAI_*`, `AZURE_OPENAI_*`, etc.), found in `.env*` files in the scanned directory and in the current `process.env`.
- `mcp-configs` — the **full contents** of any MCP / desktop-app config files it finds: `~/.claude/mcp.json`, `~/.cursor/mcp.json`, and the platform `claude_desktop_config.json` / Cursor `settings.json`. **Read the warning below — these files are sent verbatim and may contain secrets.**
- `source-imports` — `import`/`require`/`from X import Y` statements extracted from the first 5 KB of source files under `src/`, `app/`, `lib/`, etc.
- `installed-packages` — top-level package names under `node_modules/` (names only, no version data).
- `running-processes` — `ps` / `tasklist` output (deep+).
- `docker-containers` — `docker ps` output (deep+).
- `network-connections` — listening/established TCP/UDP ports from `ss` / `netstat` (deep+).

Every uploaded item is capped at 8 KB. The CLI does not bundle any
fingerprint catalog; the server classifies all evidence.

> ### Privacy warning: what stays vs. what leaves
>
> - **`.env` values never leave your machine** — only the matching key
>   *names* are reported.
> - **MCP / desktop config files are uploaded in full, unredacted.** MCP and
>   Claude/Cursor desktop config files often embed API keys, tokens, or other
>   secrets (for example in a server's `env` block). vorion-find sends those
>   files **as-is** (trimmed only to the 8 KB cap) — it does **not** strip or
>   mask secrets out of them. If your MCP configs contain credentials you do
>   not want to upload, run `--dry-run` first (and inspect the output) and/or
>   redact those files before scanning.
> - At `deep`/`fulltilt` depth, your running process list, Docker container
>   list, and listening network ports are also uploaded.
>
> When in doubt, run `--dry-run` to see exactly what *would* be sent without
> sending anything. On upload failure, the full evidence list is also printed
> as NDJSON to stderr so you can review it.

## Device identity

The CLI creates a stable UUID v4 at `~/.vorion-find/device-id` the first
time it runs. This lets aurais.net group scans from the same machine
into one device card. To reset, delete that file.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Scan completed and all findings uploaded. |
| `1` | Upload failed — findings were printed as NDJSON so you can save and retry. |
| `2` | Invalid flags. |

## Privacy

- `--dry-run` is the only mode that uploads nothing. Every other mode —
  including the no-flag auto-browser run — scans **and uploads** to the
  endpoint as it goes.
- `.env` values never leave your machine (only key names do). MCP / desktop
  config files, however, are uploaded in full — see the
  [privacy warning above](#privacy-warning-what-stays-vs-what-leaves).
- The full evidence list is printed to stderr on upload failure so you can
  inspect what *would* have been sent.
- Pair tokens expire in 15 minutes and are single-use; the token and session
  are bound to the device UUID.

## Troubleshooting

- **Browser didn't open.** Auto-browser mode is best-effort. If it can't
  launch your browser, the terminal prints the `WATCH:` URL — open it
  manually. The scan still runs and uploads regardless.
- **`error: pair claim failed` / network errors.** The CLI couldn't reach the
  endpoint. Check connectivity, then re-run. To point at a local or staging
  server, pass `--endpoint=<url>`.
- **`! pair token expired mid-scan` or "session expired".** Pair tokens live
  ~15 minutes and are single-use. Re-run (auto-browser mode mints a fresh one
  each time), or re-pair at `https://aurais.net/find`.
- **`Unknown flag` / exit code `2`.** A flag was mistyped. Run
  `npx vorion-find --help` to see the exact flag names.
- **Upload failed (exit code `1`).** Findings are dumped to stdout as NDJSON
  so you don't lose them — redirect to a file
  (`npx vorion-find --stdout > findings.ndjson`) to keep a copy.
- **A scanner seems stuck.** Each subprocess scanner (`docker`, `ps`/`tasklist`,
  `ss`/`netstat`) has a 3 s timeout and fails silently, so a hung command
  can't stall the whole scan. If a tool isn't installed, that scanner is just
  skipped.
- **Reset device identity.** Delete `~/.vorion-find/device-id` to start fresh
  as a new device.

## Trust signals you get

vorion-find is the discovery front door to the BASIS agent-governance
ecosystem: it answers "which AI agents exist on this machine, and what are
they wired to?" so they can be inventoried and evaluated. BASIS is to
AI-agent governance what OAuth is to delegated authorization — an open
standard so an agent trusted by one system can be evaluated by another. The
evidence this CLI collects feeds the aurais.net classifier; the underlying
open specs and reference tooling live in the BASIS repos:

- [github.com/vorionsys/basis-spec](https://github.com/vorionsys/basis-spec) — the BASIS specification.
- [github.com/vorionsys/basis-gate](https://github.com/vorionsys/basis-gate) — reference gate implementation.

These are open source under Apache-2.0 and are provided for reference /
starter use.

## License

Proprietary — © 2026 Vorion LLC. All rights reserved. The compiled `vorion-find`
binary is free to use to scan systems you own or are authorized to scan; the
source is provided for reference and is **not** licensed for copying,
modification, or redistribution. See [LICENSE](./LICENSE).
