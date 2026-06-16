# ContextPilot OpenCode Plugin

ContextPilot OpenCode Plugin is a native OpenCode plugin that reduces repeated LLM-bound context before each model call. It is adapted from the ContextPilot project for OpenCode's plugin system.

## What it does

- Hooks OpenCode's `experimental.chat.messages.transform` lifecycle before provider requests.
- Replaces repeated completed tool outputs with short references to the earlier result.
- Deduplicates shared blocks inside large tool outputs with content-defined chunking.
- Tracks estimated session and all-time savings in OpenCode's data directory.
- Adds a `contextpilot_status` tool for cumulative savings and dedup stats.
- Optionally exposes a TUI sidebar widget showing session and all-time token savings.

The plugin is lossless: it keeps the first occurrence of content intact and only replaces repeated content with references. It does not call another LLM and does not require a proxy.

## Install

Install from GitHub with OpenCode's plugin command:

```bash
opencode plugin anyin233/contextpilot-opencode --global
```

Or add it to your OpenCode config manually:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "anyin233/contextpilot-opencode"
  ]
}
```

If you already use other plugins, keep them and append this one:

```json
{
  "plugin": [
    "oh-my-openagent@latest",
    "anyin233/contextpilot-opencode"
  ]
}
```

Restart OpenCode after installing so it reloads the plugin list.

## Let an agent install it

Use this prompt with an OpenCode-capable agent:

```text
Install the ContextPilot OpenCode plugin in the same style as oh-my-openagent.
Preserve my existing OpenCode plugins, add anyin233/contextpilot-opencode to the global OpenCode plugin list, verify the config still parses, verify the plugin entrypoint loads, and tell me to restart OpenCode if it is already running.
```

The agent can either run:

```bash
opencode plugin anyin233/contextpilot-opencode --global
```

Or edit `~/.config/opencode/opencode.json` so the `plugin` array includes `"anyin233/contextpilot-opencode"` without removing existing entries.

## Check savings

Inside an OpenCode session, ask the agent to call the `contextpilot_status` tool. Example output:

```text
ContextPilot Status:
  Turns optimized: 8
  Chars saved: 12,840
  Tokens saved: ~3,210
  Docs deduped: 2
  Tracked hashes: 5
  Reorder: dedup-only
```

Runtime logs are written next to OpenCode logs at:

```text
~/.local/share/opencode/log/contextpilot.log
```

Savings snapshots are written to:

```text
~/.local/share/opencode/contextpilot/savings.json
```

## Local development

```bash
bun install
bun test src/**/*.test.ts
bun run typecheck
bun run build
npm pack --dry-run
```

For local OpenCode testing, add the absolute path of this repository to your OpenCode `plugin` array.

## Relationship to ContextPilot

This repository contains only the OpenCode plugin package. The broader ContextPilot project includes the original context optimization engine, Hermes integration, runtime hooks, docs, and examples:

- ContextPilot: https://github.com/EfficientContext/ContextPilot

## License

Apache-2.0.
