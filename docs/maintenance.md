# Maintaining Parallax Game Designer Opt

This fork is based on Houchen181's [Parallax v0.4.2](https://github.com/Houchen181/parallax/tree/v0.4.2). See the [README](../README.md) for setup and usage and the [LICENSE](../LICENSE) for the original copyright and license notices.

## Game design conversations

- [engine.ts](../src/renderer/src/lib/engine.ts) handles sending, broadcasting, group turns, and regeneration. [prompt.ts](../src/renderer/src/lib/prompt.ts) assembles the design guidance, brief, and context. All three modes share guidance for exploring distinct mechanics before recommending a design. Single-model chats use a consultation prompt, broadcasts give each pane the same comparison criteria, and group chats use separate proposal and discussion prompts. A participant can have a custom persona.
- In a group chat, the opening round for each ordinary user message uses a snapshot through that message. **Continue** and additional rounds see earlier replies. Use `@name` to direct a follow-up to specific models. The `groupOpening` field marks replies that reuse the opening-round context when regenerated.
- **New direction** sends the design brief and user messages, omitting earlier model replies from that request. `designAttempt` tracks the ideation approach. Targets in the same broadcast use the same approach, and regeneration reuses it. The action requests one reply per chat or one round per group and sends any draft as a new user message.
- Single-model and group chats save their brief under **Instructions / design brief**. When starting a comparison, [NewCompareDialog.tsx](../src/renderer/src/components/NewCompareDialog.tsx) copies the shared brief into each pane before sending the first message. Each pane then has its own conversation history.

## Local workspaces

- Choose **Workspace → Choose folder** in the desktop composer. The setting is saved per chat. A composer broadcasting to multiple panes applies the choice to the included panes. The comparison dialog can apply a folder before sending its first message. **Clear** detaches the folder from the selected chats.
- [The desktop main process](../src/main/workspace.ts) keeps the authorized folder paths in the app profile. Chats store an opaque folder ID and display name. A chat restored on a different device needs its folder selected there. Searches run on demand with read-only access to Markdown and plain-text documents (.md, .markdown, .txt and .text) encoded as UTF-8 or as UTF-16 with a byte-order mark. The scanner skips hidden entries, dependency directories and linked files, and bounds the scan and excerpt sizes.
- [The conversation engine](../src/renderer/src/lib/workspace.ts) asks each model for search terms, then supplies matching excerpts as reference data. A model can refine the search once. Queries and excerpts use the selected provider, so a reply that uses a workspace can take additional model requests. The conversation's reasoning effort applies to the final reply. The app resolves citation IDs to the returned relative file paths, headings and line ranges. A reply that leaves out citation IDs lists its retrieved excerpts separately.

## Reasoning effort by provider

[reasoningEffort.ts](../src/renderer/src/lib/reasoningEffort.ts) uses the scale with the most levels among the participating models. It maps the selected level to each model when a request is sent. Each conversation stores the selected value and the scale it was chosen from in `reasoningEffortScale`. In broadcast mode, a selection in the composer applies to every included pane that supports effort. If the panes have different settings, the selector shows **Mixed**. Choose a level to apply it to all of them.

| Five-level scale | Official DeepSeek API | Four-level Grok 4.7 |
| --- | --- | --- |
| `low` | `low` | `low` |
| `medium` | `low` | `medium` |
| `high` | `high` | `high` |
| `xhigh` | `max` | `xhigh` |
| `max` | `max` | `xhigh` |

Claude and GPT models with five levels use the corresponding value. The selector omits GPT's `ultra` level. An older conversation saved with `ultra` uses `max` if the target supports it. Choosing **Default** omits the effort parameter for the request. A Claude conversation with no saved effort can inherit the provider's **Effort** setting. Token budgets vary by provider even when level names match.

| Provider | Capability source and request field |
| --- | --- |
| [ChatGPT Plan](../src/renderer/src/lib/providers/chatgpt.ts) | Reads `supported_reasoning_levels` from the catalog and sends `reasoning.effort` |
| [Cursor SDK](../src/main/cursor.ts) | Reads model parameters from `Cursor.models.list()` and sends `model.params` |
| [Official DeepSeek API](../src/renderer/src/lib/providers/openai.ts) | Reads `effort.supported_levels` and sends `reasoning_effort` |
| [Claude](../src/renderer/src/lib/providers/anthropic.ts) | Reads `capabilities.effort` and sends `output_config.effort`. Cached entries without level details use the known levels for that model |

Refresh the model list under **Settings → Providers** when a provider changes its levels. For mapping changes, run `npm test -- src/renderer/src/lib/reasoningEffort.test.ts`. If a request field changes, run the relevant provider tests as well.

## Cursor sign-in and desktop runtime

- [main/index.ts](../src/main/index.ts) handles the sign-in request. [cursor.ts](../src/main/cursor.ts) uses `Cursor.auth.login()` for Cursor's browser authorization flow. Parallax encrypts the resulting personal credential with Electron `safeStorage`. With `store: null`, Parallax handles credential storage. Usage counts toward the authorized account's Cursor plan. [Cursor SDK authentication and billing](https://cursor.com/docs/sdk/typescript#usage-and-billing)
- `https://cursor-sdk.invalid` is an internal address the Electron main process uses to route Cursor model list and chat requests. Each chat request uses a temporary directory, disables agent tools, and displays the reply when the SDK run finishes. The conversation instructions are included in the SDK message for compatibility with accounts that restrict custom system prompts.
- The Electron main process loads `@cursor/sdk` at runtime. Keep `zod` in production dependencies. The packager puts the Windows SDK helper binaries in `app.asar.unpacked`. After changing dependencies or packaging rules, check that the packaged Cursor provider can load the model list.

## Windows builds and updates

Use Windows x64 and Node.js 24. Run `npm ci` in a fresh checkout. `npm run dev` starts the development app. `npm run dist:win` builds the installer into `release/`. The app uses the Parallax product name and app ID so an existing installation can keep its user data directory. For an isolated development profile, set `PARALLAX_USER_DATA` before launching the app. In PowerShell, use `$env:PARALLAX_USER_DATA = Join-Path $env:TEMP 'parallax-dev-profile'`.

Use the installer to update an existing installation. For a temporary local update from `win-unpacked`, quit Parallax and use `Parallax.exe`, `resources/app.asar`, and `resources/app.asar.unpacked` from the same build. The executable contains integrity information for the matching archive.

## Upstream and releases

- To sync changes from the original project, add `https://github.com/Houchen181/parallax.git` as the `upstream` remote. Review changes to Electron IPC, model catalogs, the group chat engine, and packaging before merging.
- After editing prompts or provider code shared by the plugin and desktop app, run `npm run build:plugin`. Commit any updates to the tracked bundle and license notices in `plugins/parallax/server/`. GitHub Actions checks the bundle and builds the web app on `main`.
- The GitHub Pages deployment steps run on the upstream repository. To release a Windows installer for this fork, bump the version and push a new `v*` tag to trigger the release workflow. Keep application data, credentials, and local `release/` artifacts on the workstation.
