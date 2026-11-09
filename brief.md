# Product Brief — Local AI Copilot for VS Code

## 1. What we want to build

A lightweight **VS Code extension that recreates the original GitHub Copilot inline autocomplete experience**, combined with Cursor-style Cmd + K code editing.

The extension runs AI models locally on a **MacBook Pro M5 Max (40-core GPU, 128 GB RAM)**, with fast, intelligent code suggestions and no dependency on external AI APIs.

The goal is a coding assistant that feels **fast, natural, unobtrusive, and deeply integrated into VS Code**.

## 2. Core features

**1. Inline code autocomplete (single and multiline)**

- As the user types, automatically suggest the next code to write.
- Display suggestions as native VS Code ghost text (greyed-out code).
- Support both single-line and multiline suggestions.
- Press `Tab` to accept; continue typing or press `Esc` to dismiss.
- Use surrounding code to understand what to generate.

**2. Comment → Code generation**

- Detect comments that describe an implementation, e.g. `// Create a function that validates an email`.
- Automatically suggest the corresponding implementation as multiline ghost text.
- Use the same autocomplete system, with prompts adapted for longer code generation.

**3. Inline Cmd + K editing**

- Select code and press `Cmd + K` to open an AI instruction input.
- Write an instruction such as "Optimize this function" or "Add error handling".
- The AI generates replacement code.
- Replace only the target code with changes
- If no code is selected, target the current line or surrounding function.

**4. File-level Cmd + K editing**

- Trigger a separate command (`Cmd + Shift + K`) to modify the current file.
- Give instructions such as "Refactor this file to use async/await".
- The AI can use relevant context from other files when necessary.
- Preview all modifications before accepting them.

## 3. AI models and technologies

**Code generation — Qwen3.6-35B-A3B**

- Main model responsible for generating and modifying code.
- Runs locally on the Mac using an Apple Silicon-optimized inference engine, preferably MLX or llama.cpp, depending on compatibility and benchmarks.
- Start with 4-bit quantization and non-thinking generation for autocomplete.
- Access through a local HTTP API, preferably OpenAI-compatible.

**Decision engine — Joey-1 2B**

- Small, fast model used to make intelligent decisions about suggestions and context.
- Determines whether a suggestion is useful, whether a comment requests implementation, and what context an edit requires.
- Prefer local inference, but verify Apple Silicon compatibility with its specialized decision outputs first.
- Make this component optional and replaceable with simple TypeScript rules. Hosted inference can be used for initial testing if local support is unavailable.

**Extension technologies**

- TypeScript + VS Code Extension API.
- Native `InlineCompletionItemProvider` for ghost-text suggestions.
- VS Code commands and keyboard shortcuts for AI editing.
- HTTP client for communicating with local inference services.

No database, cloud backend, embeddings, or vector database is needed.

## 4. How the system works

### Shared architecture

```text
VS Code (user types or presses Cmd + K)
    ↓
Extension / Orchestrator (TypeScript)
    ├── Detect event and collect code context
    ├── Rules + Joey-1 → Make decisions
    └── Qwen → Generate or modify code
    ↓
Display result in VS Code
    ├── Ghost text for autocomplete
    └── Diff + Accept / Reject for editing
```

### Logic for each feature

**Autocomplete**

```text
User types
→ Extension detects a short typing pause
→ Gather code before and after cursor, plus relevant imports
→ Rules / Joey decide whether a suggestion would be useful
→ Qwen generates the missing code
→ Display ghost text
→ Tab accepts the suggestion, Esc cancels it
```

For low latency, Joey and Qwen may run in parallel rather than waiting for one another (in this case if Joey decide to not display, cancel qwen's generation, otherwise display it)

**Comment → Code**

```text
User writes a comment
→ Detect whether it requests an implementation
→ Gather surrounding code
→ Ask Qwen to implement the comment
→ Show multiline ghost text
→ Tab accepts
```

**Inline Cmd + K**

```text
User selects code and presses Cmd + K
→ Show instruction input
→ Collect selected code and surrounding context
→ Joey optionally classifies edit intent/scope
→ Qwen generates replacement code
→ Display ghost code
→ User press Tab or Esc
```

**File-level Cmd + K**

```text
User presses Cmd + Shift + K
→ Show instruction input
→ Read current file
→ Joey optionally decides if related files are needed
→ Gather relevant context
→ Qwen generates modified file
→ Display diff
→ User accepts or rejects
```

## 5. Performance and UX requirements

**Speed is a top priority.** The extension must feel like a native coding tool, not a chatbot.

- Target under 300 ms for short autocomplete suggestions where feasible; measure real end-to-end latency on the target Mac.
- Debounce typing events to avoid unnecessary inference.
- Cancel or discard outdated requests when the user continues typing.
- Cache and reuse valid suggestions when possible.
- Keep autocomplete context small; use larger context for explicit edits.
- Run Joey and Qwen in parallel when beneficial, but benchmark GPU contention.
- Never block typing or normal editor interactions.
- Prevent stale AI responses from modifying code that has since changed.
- Keep the interface minimal: ghost text, keyboard shortcuts, and clear accept/reject controls.

For Cmd + K, prioritize correctness and good diffs over sub-second latency.

## 6. Definition of success

The product is successful when it provides a **Copilot-quality editing experience powered by local models**, with fast autocomplete, reliable multiline generation, simple keyboard-driven AI editing, and minimal interruption to the coding workflow.

**Guiding principle:** Build the simplest, fastest working system first. Use AI decision-making only where it performs better than conventional logic. Prioritize the quality and responsiveness of the coding experience over architectural complexity.

