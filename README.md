# lark-codex-bridge

A lightweight Feishu / Lark chat bridge for local AI coding CLIs. DM the bot, or `@bot` in a group, and Codex or Claude Code runs on your machine in the workspace you choose.

[中文 README](./README.zh.md)

## Features

- DM replies by default; groups and topic groups require `@bot` by default
- Selectable local agent: Codex by default, Claude Code optional
- Per-chat / per-topic agent sessions with automatic resume
- `/new`, `/reset`, and `/stop` for session control
- `/new chat [name]` to create a fresh group chat and invite the operator
- `/cd <path>` and `/ws list|save|use|remove` for workspace switching
- `/agent codex|claude` or `/config` to switch the active agent
- `/status`, `/help`, `/config`, and workspace lists as interactive Lark cards
- Agent output rendered as streaming cards or markdown messages
- Images are downloaded locally and passed to Codex as image inputs; Claude Code sees the local attachment paths in the prompt
- Quoted messages and received Lark cards are expanded into prompt context

## Out of Scope

- Cloud-doc comment mentions
- Calendar, approval, docs, or other Lark business API integrations
- `/doctor` log diagnosis
- lark-cli auto-install / binding

## Prerequisites

- Node.js >= 20
- Codex CLI installed and logged in, or Claude Code CLI installed and logged in

```bash
npm install -g @openai/codex
codex

# Optional, when using /agent claude
claude
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

`run` keeps the bot attached to the current terminal. Closing that terminal stops the foreground process.

For normal use, start the OS-managed daemon instead:

```bash
node ./bin/lark-codex-bridge.mjs start
node ./bin/lark-codex-bridge.mjs status
```

`start` installs and launches a background service. On macOS it writes a user LaunchAgent:

```text
~/Library/LaunchAgents/ai.lark-codex-bridge.bot.plist
```

That LaunchAgent runs `node ./bin/lark-codex-bridge.mjs run` with `RunAtLoad` and `KeepAlive`, so closing the terminal does not stop the bot. If you move or delete this repository, rerun `start` from the new path so the service points at the right entry file.

Daemon logs are written to:

```bash
tail -f ~/.lark-codex/logs/daemon-stderr.log
tail -f ~/.lark-codex/logs/daemon-stdout.log
```

To manage the daemon:

```bash
node ./bin/lark-codex-bridge.mjs restart
node ./bin/lark-codex-bridge.mjs stop
node ./bin/lark-codex-bridge.mjs unregister
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
| `/resume [N]` | List recent sessions for the active agent and resume one |
| `/agent [codex\|claude]` | Show or switch the active local agent |
| `/cd <path>` | Switch cwd and reset the session |
| `/ws list` | Show workspace card |
| `/ws save <name>` | Save current cwd as a named workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |
| `/status` | Show cwd / session / agent status |
| `/config` | Adjust reply mode, tool display, concurrency, and access control |
| `/stop` | Stop the active agent run |
| `/timeout [N\|off\|default]` | Configure idle timeout for this session |
| `/ps` | List running bots on this machine |
| `/exit <id\|#>` | Stop a specific bot |
| `/reconnect` | Force a Lark WebSocket reconnect |
| `/help` | Show help card |

Everything else is forwarded to the active agent.

## Agent Selection

Codex is the default for existing configs. To switch from Feishu:

```text
/agent claude
/agent codex
```

You can also use `/config` and choose the Agent field. The setting is saved in:

```json
{
  "preferences": {
    "agent": "claude"
  }
}
```

Codex and Claude Code session ids are kept separate. Switching agents resets the current chat's resumable session so the bridge does not try to resume a Codex session with Claude or the reverse.
