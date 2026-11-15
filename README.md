# AGY Context Monitor

Clean, zero-dependency, maintainable context-window and observed TPS monitor plugin for Google Antigravity 2.x.

## Design Philosophy (Official Contract Only)

Unlike DOM-injection or internal Language Server RPC probing tools (`app.asar` patching / `DevToolsActivePort` / undocumented gRPC endpoints), **AGY Context Monitor** uses exclusively documented Antigravity 2.x plugin interfaces:

1. **Plugin, Auxiliary Sidecar UI & Bundled Skill** (`plugin.json` + `sidecars/dashboard/sidecar.json` + `skills/context-monitor/SKILL.md` + `sidecar_sdk`):
   Renders cleanly inside Antigravity's native auxiliary side pane (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`) with read-only permissions (`"allows_user_interactions": false`), supports one-click conversation jump (`window.sidecar.ui.toggleConversation`), and ships a native `context-monitor` skill backing its `suggestedPrompts`.
2. **Multi-Surface Session Transcript Telemetry** (`~/.gemini/{antigravity,antigravity-ide,antigravity-cli}/brain/<conversationId>/.system_generated/logs/transcript.jsonl`):
   Reads documented token accounting (`input_tokens`, `cache_read_tokens`, `output_tokens`), step status, `CHECKPOINT` compaction summaries, tool call counts, `<USER_SETTINGS_CHANGE>` model switches, and subagent/swarm `sender=<uuid>` parent links across Desktop, IDE, and CLI surfaces.
   - `contextUsedTokens = input_tokens + cache_read_tokens + output_tokens` (uncached input + cached prompt prefix + retained step output)
   - `cacheHitRate = cache_read_tokens / (input_tokens + cache_read_tokens)`
   - **Effective Window Calibration vs. Nominal Spec**: Official model specs (e.g., `1M` for Gemini 4 / Claude 5.5) exceed Antigravity's host compaction ceilings (`256K` = `262,144` for Gemini 4 Hydrogen/Carbon/Flash, `128K` = `131,072` for Gemini 4 Argon/GPT-OSS 120B, `200K` for Claude). `Auto` mode calibrates against Antigravity host effective windows and learns from real `CHECKPOINT` compaction triggers while displaying the upstream nominal spec separately.
3. **Lifecycle Hooks & Zero-Token Chat Hints** (`hooks.json` -> `hooks/run-hook.sh` -> `hooks/record-timing.mjs`):
   - Records lightweight invocation timestamps (`SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`) plus sanitized workspace folder basenames (`ws`) into `plugin_data/agy-context-monitor/timings/<conversationId>.jsonl`.
   - Injects 0-model-token inline UI pills (`systemMessage: ""` + `metadata.user_markdown`) on `SessionStart` (`📊 [Context & TPS](sidecar://agy-context-monitor/dashboard/)`) and once per compaction cycle when context reaches >=85% (both toggleable in dashboard settings).

> **Note on Timing, Cost & Privacy Scope**
> - Observed TPS reflects end-to-end step generation speed (`output_tokens / elapsedSec`), including model reasoning/TTFT when included in the invocation step duration.
> - USD cost & prompt-cache savings are reference estimates based on public per-million-token API pricing tiers; account-level 5h/weekly quota bars are intentionally omitted because Antigravity does not expose a documented billing quota API.
> - No raw prompt, user message, full personal directory path, or thinking text is ever cached, logged by hooks, or served via HTTP APIs. Conversation picker titles (max 28 chars) live in process memory only.

## What the dashboard shows (and how it decides)

| Feature | Behaviour |
|---|---|
| **Model name** | Transcript `Model Selection` switches first (exact display names). Hook model ids are prettified fallbacks (`claude-opus-5-5-high` → `Claude Opus 5.5 (High)`), ignoring internal worker ids (`*-worker-*`, `*-agy`). Unswitched user sessions inherit the global selection at start ("inferred"). |
| **Compaction & Forecast** | Manual `/compact` checkpoints are separated and never calibrate `Auto` capacity. Forecasts remaining turns & model calls before auto-compaction from recent context growth. |
| **Cache busts & API savings** | Flags non-compaction prompt cache drops (`⚡`: `ttl-expired` after >5m idle, `model-switch`, `prefix-invalidated`) and estimates equivalent USD cost + prompt-cache savings. |
| **Subagent & Swarm attribution** | Breaks down subagents and Swarm workers into their **actual models** using 1) hook runtime `model` logs, 2) parent `swarm` (`add`/`model`/`status`) `model_display_name` metadata, and 3) parent `invoke_subagent` `Model` (`inherit` / `flash` / `pro`), while also rolling child calls & tokens up onto the root user session (`↳` call count shown in "By model"). |
| **Auto-follow & Jump** | Supports `⚡ Follow newest conversation` inside both standalone browser and embedded Aux Pane, plus one-click `↗ Open` (`toggleConversation`) to jump to any inspected session. |
| **Multi-surface & Workspaces** | Aggregates 30-day usage across `antigravity` (Desktop), `antigravity-ide` (IDE), and `antigravity-cli` (CLI), broken down by model and workspace folder. |

## Directory Layout

```text
agy-context-monitor/
├── plugin.json                      # Antigravity plugin manifest
├── hooks.json                       # SessionStart, PreInvocation, PostInvocation, Stop hooks
├── assets/logo.svg                  # Transparent light/dark adaptive plugin icon
├── hooks/
│   ├── run-hook.sh                  # Portable macOS/Unix Node locator with fail-safe JSON output
│   └── record-timing.mjs            # Fail-safe timestamp recorder + 0-token user_markdown pills
├── skills/context-monitor/
│   ├── SKILL.md                     # Native skill backing suggestedPrompts & telemetry queries
│   └── scripts/query.mjs            # Direct CLI query helper over calibrated metrics/rollup
├── sidecars/dashboard/
│   ├── sidecar.json                 # Read-only Aux-pane sidecar registration
│   ├── main.mjs                     # SidecarApp / 127.0.0.1 standalone server
│   ├── lib/
│   │   ├── paths.mjs                # Multi-surface AppData / workspace sanitizer / UUID validation
│   │   ├── models.mjs               # Model capacity rules, pricing tiers, switch parser
│   │   ├── transcript.mjs           # Mtime/size cached JSONL parser & hook pairing
│   │   ├── metrics.mjs              # Context, cache bust, cost, subagent & TPS metrics
│   │   ├── usage-rollup.mjs         # Incremental UTC+8 30-day, model, workspace & surface rollup
│   │   └── preferences.mjs          # Persisted window overrides, locale & chat-hint toggles
│   └── public/                      # CSP-strict zero-dependency web dashboard
├── scripts/install.mjs              # Install / uninstall / status utility
└── tests/                           # Node native test runner suite
```

## Commands

```bash
# Clone & install into Antigravity (~/.gemini/config/plugins/agy-context-monitor)
git clone https://github.com/RaDiAlien/agy-context-monitor.git
cd agy-context-monitor
npm run install-plugin

# Run unit & integration tests
npm test

# Check install status
npm run status

# Uninstall plugin (add -- --purge-data to also delete plugin_data)
npm run uninstall-plugin

# Run standalone dashboard preview in a browser (http://127.0.0.1:4789)
npm start
```
