# vorion-find

Scan a local device for AI agents and stream findings to [aurais.net](https://aurais.net).
The browser runs the UI and shows classified results live; this CLI just
collects evidence and posts it.

## Install

No install needed. Use `npx`:

```bash
npx vorion-find --pair=NEW
```

Or install globally (not required):

```bash
npm install -g vorion-find
vorion-find --pair=NEW
```

Node.js 20+ required.

## Usage

There are two ways to pair:

### 1. CLI-mints a session (easiest)

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
| `--pair=NEW` or `--pair=<sid>:<token>` | (required) | Pair handshake. |
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

## What it sends

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

- `package-deps` — `dependencies` map from a `package.json` / `pyproject.toml` / `requirements.txt`.
- `env-keys` — the **names** (never the values) of env vars matching AI-related prefixes (`OPENAI_*`, `ANTHROPIC_*`, `LANGCHAIN_*`, `GOOGLE_GENAI_*`, `AZURE_OPENAI_*`, etc.).
- `mcp-configs` — full contents of `~/.claude/mcp.json`, `~/.cursor/mcp.json`, `claude_desktop_config.json`, etc.
- `source-imports` — `import`/`require`/`from X import Y` statements extracted from the first 5 KB of source files.
- `installed-packages` — top-level package names in `node_modules/` (names only, no version data).
- `running-processes` — `ps` / `tasklist` output (deep+).
- `docker-containers` — `docker ps` output (deep+).
- `network-connections` — listening TCP/UDP ports (deep+).

Every item is capped at 8 KB. `.env` values are **never** sent — only the
key names. The CLI does not bundle any fingerprint catalog; the server
classifies all evidence.

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

- Nothing is uploaded unless you pass `--pair` (or explicitly use `--dry-run`).
- `.env` values never leave your machine.
- The full evidence list is printed to stderr on upload failure so you can
  inspect what *would* have been sent.
- Pair tokens expire in 15 minutes and are single-use; token and session
  are bound to the device UUID.

## License

MIT © Vorion LLC
