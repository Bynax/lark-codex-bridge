# lark-codex-bridge

A lightweight Feishu / Lark chat bridge for the local Codex CLI. DM the bot, or `@bot` in a group, and Codex runs on your machine in the workspace you choose.

[中文 README](./README.zh.md)

## Features

- DM replies by default; groups and topic groups require `@bot` by default
- Per-chat / per-topic Codex sessions with automatic resume
- `/new`, `/reset`, and `/stop` for session control
- `/new chat [name]` to create a fresh group chat and invite the operator
- `/cd <path>` and `/ws list|save|use|remove` for workspace switching
- `/status`, `/help`, `/config`, and workspace lists as interactive Lark cards
- Codex output rendered as streaming cards or markdown messages
- Images are downloaded locally and passed to Codex as image inputs
- Quoted messages and received Lark cards are expanded into prompt context

## Out of Scope

- Cloud-doc comment mentions
- Calendar, approval, docs, or other Lark business API integrations
- `/doctor` log diagnosis
- lark-cli auto-install / binding

## Prerequisites

- Node.js >= 20
- Codex CLI installed and logged in

```bash
npm install -g @openai/codex
codex
```

## Run

```bash
pnpm install
pnpm build
node ./bin/lark-codex-bridge.mjs run
```

The first run opens the Feishu / Lark app registration wizard if no config exists. Runtime state is stored under:

```text
~/.lark-codex/
```

## Host Commands

```text
lark-codex-bridge run [-c <config>]   Run the bot in the foreground
lark-codex-bridge ps                  List running bridge processes
lark-codex-bridge kill <id|#>         Kill a bridge process

lark-codex-bridge start               Install and start the OS daemon
lark-codex-bridge stop                Stop the daemon
lark-codex-bridge restart             Restart the daemon
lark-codex-bridge status              Show daemon status
lark-codex-bridge unregister          Remove service registration
```

## Lark Commands

| Command | Effect |
|---|---|
| `/new`, `/reset` | Clear the current chat session |
| `/new chat [name]` | Create a new group chat |
| `/resume [N]` | List recent Codex sessions and resume one |
| `/cd <path>` | Switch cwd and reset the session |
| `/ws list` | Show workspace card |
| `/ws save <name>` | Save current cwd as a named workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |
| `/status` | Show cwd / session / agent status |
| `/config` | Adjust reply mode, tool display, concurrency, and access control |
| `/stop` | Stop the active Codex run |
| `/timeout [N\|off\|default]` | Configure idle timeout for this session |
| `/ps` | List running bots on this machine |
| `/exit <id\|#>` | Stop a specific bot |
| `/reconnect` | Force a Lark WebSocket reconnect |
| `/help` | Show help card |

Everything else is forwarded to Codex.
