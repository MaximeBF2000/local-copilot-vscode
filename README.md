# Local Copilot

Copilot-style inline autocomplete and Cursor-style inline AI editing (`Cmd+J`) for VS Code, powered entirely by **local Ollama models**. No cloud, no API keys, no telemetry.

| Feature | How |
| --- | --- |
| **Inline autocomplete** (single and multiline) | Just type. Ghost text appears after a short pause. `Tab` accepts, `Esc` or typing on dismisses. `Alt+\` asks explicitly. |
| **Comment → code** | Write a comment like `// Create a function that validates an email`, press `Enter`: the implementation appears as ghost text. |
| **Inline edit** (`Cmd+J`) | Select code (or put the cursor in a function or on a blank line), press `Cmd+J`, type an instruction. The original code turns red and the proposal appears in green. `Tab` accepts, `Esc` rejects (or use the Accept / Reject buttons above the code). |
| **File edit** (`Cmd+Shift+J`) | Type an instruction for the whole file. A diff opens to review the changes. Accept or reject from the title bar ✓ / ✕ buttons or the notification. |

## Requirements

- [Ollama](https://ollama.com) running locally (default `http://localhost:11434`).
- A code model. The default is `qwen3.6:35b-mlx`. Any installed Ollama model can be chosen with **Local Copilot: Select Model**, or by clicking the status bar item.

## Measured performance

Measured on a MacBook Pro M5 Max with `qwen3.6:35b-mlx` (MLX, NVFP4). Run `npm run benchmark` to reproduce.

| Task | Latency |
| --- | --- |
| Single-line / short completion | **50–100 ms** model time |
| Comment → function (5–25 lines) | 250–900 ms |
| Cmd+J inline edit (10-line function) | ~0.5 s |
| Cmd+Shift+J file refactor (25-line file) | ~1.2 s |

## Models

All models are configurable. Settings are under `localCopilot.*`. The status bar menu covers the common ones.

| Setting | Default | Role |
| --- | --- | --- |
| `localCopilot.model` | `qwen3.6:35b-mlx` | Autocomplete, and edits unless overridden |
| `localCopilot.editModel` | *(same as model)* | Cmd+J / Cmd+Shift+J edits |
| `localCopilot.decision.model` | `nimble:latest` | Decisions, when `decision.engine` is `model` |

**Prompt formats.** Autocomplete uses the model's *fill-in-the-middle* tokens, which makes it fast and context-aware. The format is detected from the model name (Qwen, DeepSeek-Coder, CodeLlama, StarCoder, CodeGemma). Models without fill-in-the-middle fall back to a slower instruction prompt. You can force a format with `localCopilot.autocomplete.promptFormat`.

## The decision engine

The orchestrator asks a few small questions while it works:

1. Would a suggestion help here?
2. Does this comment ask for code?
3. For Cmd+J without a selection: should the edit target the current line or the whole function?
4. For Cmd+Shift+J: are the imported files needed as context?

`localCopilot.decision.engine` selects how they are answered:

- **`rules`** (default): instant TypeScript heuristics.
- **`model`**: a small local decision model with Ollama's `decision` capability. It answers with a one-letter choice and calibrated probabilities. Rules still veto obvious cases first, and any error, or a timeout (`decision.timeoutMs`, 400 ms by default), falls back to the rules.

**Why rules are the default.** On the bundled benchmark of comment intents, the rules scored 13/14 at about 0 ms. A 9B decision model (`nimble`) scored 10/14 at about 95 ms. The guiding principle is to use AI decisions only where they beat conventional logic, so the model stays opt-in.

**About Joey-1.** Joey-1 is currently distributed only as a CUDA runtime (no GGUF, MLX or Ollama build), so it can't run on Apple Silicon yet. Once an Ollama build exists, select it with **Local Copilot: Select Decision Model**. Running the decision model in parallel with Qwen showed no measurable GPU contention.

## How it works

```
VS Code ──► Orchestrator (TypeScript)
              ├─ collect context (code around cursor, imports / selection / file + imported files)
              ├─ decisions (rules or decision model) — runs in parallel with generation for autocomplete
              └─ Ollama (local HTTP)
                    ├─ autocomplete: raw fill-in-the-middle prompt
                    └─ edits: chat prompt → replacement code / SEARCH-REPLACE blocks
VS Code ◄── ghost text · red/green inline proposal · diff view
```

Autocomplete keeps the UI responsive:

- **Debounce.** Waits for a 75 ms typing pause.
- **Cancellation.** Every keystroke cancels the outstanding request and aborts the HTTP call, so Ollama stops generating.
- **Cache.** Recent suggestions are reused, including while you "type through" a suggestion.
- **Small context.** 120 lines before the cursor and 40 after, plus the file's imports when the top is cut off.
- **Scoped output.** Single-line mode stops at the first newline. Multiline mode stops when the code leaves the current block, and drops lines that already exist after the cursor.

Stale results are never applied:

- Inline edits are discarded if the target code changed while generating.
- File edits are discarded if the file changed while generating.
- A file edit asks before overwriting a file that changed after the proposal was generated.

**File edits.** The model answers with SEARCH/REPLACE blocks, which is fast because only the changed parts are generated. If a block doesn't match the file, the extension falls back to asking for the whole file.

## Commands and shortcuts

| Command | Shortcut |
| --- | --- |
| Local Copilot: Edit Selection with AI | `Cmd+J` (`Ctrl+J`) |
| Local Copilot: Edit File with AI | `Cmd+Shift+J` (`Ctrl+Shift+J`) |
| Accept / Reject AI Edit | `Tab` / `Esc` while a proposal is shown |
| Cancel AI Generation | `Esc` while generating |
| Select Model / Select Edit Model / Select Decision Model | — |
| Change Keyboard Shortcuts | opens the shortcut editor filtered to Local Copilot |
| Toggle Autocomplete · Show Menu · Show Logs | click the status bar item |

> Both shortcuts can be changed: run **Local Copilot: Change Keyboard Shortcuts** (also in the status bar menu) and set new keys for *Edit Selection with AI* and *Edit File with AI*. Inside a text editor, `Cmd+J` replaces VS Code's default "Toggle Panel" binding; it still works everywhere else.

## Development

```bash
npm install
npm test                  # unit tests (no VS Code, no Ollama)
npm run benchmark         # latency / quality against your local Ollama
npm run test:integration  # runs inside a hidden, isolated VS Code instance (needs Ollama)
npm run package           # builds local-copilot-<version>.vsix
```

Press `F5` in VS Code to launch an Extension Development Host. Enable `localCopilot.debugLogging` to see timings for every request in the **Local Copilot** output channel.

### Code map

```
src/
  extension.ts               wiring: providers, commands, settings changes, model warm-up
  config.ts                  typed settings
  services.ts                shared Ollama client + decision engine (rebuilt on settings change)
  statusBar.ts · menu.ts · logger.ts
  ollama/
    ollamaClient.ts          generate (raw FIM), streaming chat, next-token probabilities, list models
    modelPicker.ts           quick pick over installed models
  completion/                autocomplete
    inlineCompletionProvider.ts   VS Code provider: debounce, cache, cancellation, decisions
    completionGenerator.ts        prompt → Ollama → cleaned suggestion
    completionContext.ts          code around the cursor (+ imports)
    completionMode.ts             single line / multiline / comment → code
    comments.ts · fimTemplates.ts · postProcess.ts · completionCache.ts
  decisions/
    decisionEngine.ts        interface + rules engine
    rules.ts                 the heuristics
    modelDecisionEngine.ts   decision model with rules fallback
    decisionPrompt.ts        one-letter schema prompt + probability reading
  edit/
    inlineEditController.ts  Cmd+J flow
    inlineEditSession.ts     red/green proposal, Tab/Esc, tracking user edits
    editTarget.ts            selection / line / enclosing function
    fileEditController.ts    Cmd+Shift+J flow
    proposalDiff.ts          diff view + accept/reject
    editBlocks.ts            SEARCH/REPLACE parsing and applying
    editPrompts.ts · codeExtraction.ts · relatedFiles.ts · importParsing.ts · lineBlocks.ts · generationIndicator.ts
```
