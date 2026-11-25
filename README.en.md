# dsh-agy-bridge

[中文](README.md) | English

**This is an interface bridge, not a reverse proxy.** It gives the signed-in official Google Antigravity CLI (`agy`) on your machine a conversation interface in DeepSeek Harness (DSH), talking to `agy acp` locally over the public [Agent Client Protocol (ACP)](https://agentclientprotocol.com/). The bridge does not read, export, or forward agy login credentials, open a separate HTTP or OpenAI-compatible port, or expose agy as a service to other programs or the network.

Model usage and quota belong to your own agy account. agy manages its tools, workspace trust, and native permissions; DSH provides the interface, conversation management, and an approval surface. **This is an unofficial project and is not affiliated with Google.** Antigravity, Gemini, and other trademarks belong to their respective owners. Please follow Antigravity's terms of service.

## Install

1. Install the official Antigravity CLI and run `agy --version`. If necessary, run `agy` or `agy acp --login` to sign in directly through the CLI.
2. Download or clone this repository. In DSH, open **Plugins → Add plugin**, select the local `dsh-agy-bridge` directory, and follow the refresh or restart prompt. No build or install scripts are needed.
3. Start a conversation, preferably in an empty test workspace. Select **Google Antigravity CLI → Gemini 3.8 Flash**, set the thinking level to **Low**, and ask for only `OK`, without tools.

### Upgrade from `@local/dsh-agy`

Remove `@local/dsh-agy` in DSH **Plugins**, then add the new local directory. If you plan to rename the directory, remove the old local install first so its link does not break. Do not enable both versions: they use the same provider ID, `agy`, so existing conversations and model selections do not need to be rewritten.

On first startup, if `$DSH_HOME/dsh-agy-bridge/` does not exist and `$DSH_HOME/dsh-agy/` does, the bridge copies any `settings.json` and `sessions.json` from the old directory. It leaves the original files intact. If the new directory already exists, the bridge neither overwrites nor fills it from the old one. When unset, `DSH_HOME` defaults to `~/.dsh`. The old `{executable}` settings format still works. Restart DSH and refresh any open Web page after applying the upgrade.

## Use

### Models, quota, and display settings

- The DSH model picker lists model families and their available thinking levels. The default is `High`, or the highest regular level if `High` is unavailable (`Medium`, then `Low`); `XHigh` is used when it is the only level. Models with zero or one fixed level have no extra control. Sessions using old IDs such as `gemini-3.8-flash-low` keep their original level.
- In **Settings → Antigravity CLI**, version, quota, and models refresh independently. The settings and last successful readings can be shown before a refresh completes. Sign-in status is based on the result of `/usage`.
- **Model visibility** defaults to all models shown. You can hide a family without changing an existing session. Keep at least one visible; **Select all (reset)** followed by Save restores the full list.
- Models appear in the picker as `agy-` plus the original name (for example `agy-Gemini 4 Neon`); internal model IDs are unchanged.
- agy's thoughts, tool calls, and answer stream as separate blocks in order. Each tool takes one line (only the first line of a multi-line command); only failures or cancellations get an extra note.
- The bundle adds an **Antigravity CLI** agent mode with no DSH prompt, tools, or instruction files. Global plugins such as hooks still apply; pick it manually when using an agy model.
- With an agy model or the Antigravity CLI mode, a quota strip above the composer shows the remaining 5-hour and weekly quota (Gemini and Claude/GPT, with reset time on hover). It refreshes after each reply and has a manual refresh button.
- **Show agy tool activity in chat** is on by default. Turning it off hides progress lines but not permission questions or notices. Leave **agy executable path** blank to try `~/.local/bin/agy` first, then `PATH`. If supplying a path, use a trusted local executable. Changing it stops the old ACP process and starts a new one on demand.

### Permissions and workspaces

- agy permission requests normally use native DSH approval. Standard allow-once/deny uses the approval card. Extra choices such as “always allow” are presented as offered and are remembered by agy. No approval is granted when a request times out (two minutes), the UI is unavailable, or the call is non-interactive. Cancelling the conversation withdraws pending requests.
- Under **Full access** in the DSH composer, the bridge chooses ACP's **allow once** when offered. It notes the decision even if tool progress is hidden. DSH's experimental **Auto review** only reviews DSH tools; agy requests under that preset still use ordinary approval. **The DSH sandbox does not confine the separate agy process.**
- New ACP sessions use agy's default mode. Use the composer’s **agy mode** control or `/agy-mode <default|accept-edits|auto|plan>` to switch; without an argument it shows the current mode. Explicit choices survive reconnects and replay. `accept-edits` and `auto` may let agy act without prompting; only permission requests sent by agy pass through the bridge.
- ACP uses the DSH session's working directory. The bridge does not edit `trustedWorkspaces`; check trust in the CLI from that same directory if needed. Starting a session does not mean that the directory or its tools are trusted.

### Commands and history

- `/usage` or `/quota` checks quota without calling a model. The command uses the DSH host's timezone; the settings page uses the browser's local time.
- `/agy` lists the commands agy advertises. `/agy <command> [args]` queues the native slash command in the DSH conversation without appending other plugins' context. If the ACP session needs historical context, send a normal message before retrying the command. These commands are for agy sessions only.
- Normal turns send only new user content, including any plugin context already in user messages. No DSH system prompt or DSH tool definitions are passed to agy. agy reads workspace instructions such as `AGENTS.md` itself. A fork, rollback, compaction, or model switch can cause the bridge to start a fresh ACP session and carry over visible conversation text; matching sessions attempt `session/resume` after restart.
- Settings and mappings are stored in `$DSH_HOME/dsh-agy-bridge/` (`~/.dsh/dsh-agy-bridge/` by default). Mappings include session IDs, tail input/reply text, and modes, not complete chat backups. CLI conversations are still stored according to agy's own rules. Uninstalling the bridge does not delete this data.

## Limits and verification

- This release advertises text input only and does not map DSH temperature, output limits, or stop sequences. The context window is fixed at 1,048,576 in the bridge; it is not read from agy. Existing agy history is not imported.
- Failed or cancelled requests are not resent in the same ACP session, but a retry can replay them in a new one. Completed tool actions cannot be undone and can occur again. Read-only progress lines are not a complete log; DSH tool hooks do not intercept agy tools.
- Auxiliary calls such as titles and compaction open separate temporary ACP sessions; explicit task instructions go into those calls as user text, not into the main conversation. Extra calls from plugins that follow the current model use your agy quota.
- Run `npm run check` and `npm test` with Node.js 24. `npm run smoke` uses the real signed-in CLI and Flash Low in an isolated temporary directory, **consuming a small amount of real quota**. Pass `npm run smoke -- /path/to/agy` for a custom executable or set `AGY_TEST_PERMISSION=1` to include the optional permission probe.

ACP references: [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [tool permissions](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission), [cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation), and [slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands). License: [MIT](LICENSE).
