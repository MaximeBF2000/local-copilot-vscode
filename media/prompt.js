// Prompt card script. Talks to InsetPrompt (src/prompt/insetPrompt.ts) with postMessage.
// The extension owns the state and sends it whole; this script only renders it and reports input.
// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code.
  const vscode = acquireVsCodeApi();
  const card = /** @type {HTMLElement} */ (document.querySelector('.card'));
  const messages = /** @type {HTMLElement} */ (document.getElementById('messages'));
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));
  const statusText = /** @type {HTMLElement} */ (document.getElementById('status-text'));
  const spinner = /** @type {HTMLElement} */ (document.getElementById('spinner'));
  const chip = /** @type {HTMLElement} */ (document.getElementById('chip'));
  const hint = /** @type {HTMLElement} */ (document.getElementById('hint'));
  const stopButton = /** @type {HTMLButtonElement} */ (document.getElementById('stop'));
  const closeButton = /** @type {HTMLButtonElement} */ (document.getElementById('close'));

  let busy = false;
  let renderedMessages = '';

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 90)}px`;
    reportHeight();
  }

  /** Lets the extension grow or shrink the embedded area to fit the card. */
  function reportHeight() {
    vscode.postMessage({ type: 'height', px: Math.ceil(card.getBoundingClientRect().height) + 8 });
  }

  function render(state) {
    document.body.classList.toggle('centered', state.centered);
    input.placeholder = state.placeholder;
    chip.textContent = state.chip || '';
    chip.hidden = !state.chip;

    const html = state.messages
      .map((m) => `<div class="message ${m.role}">${m.html}</div>`)
      .join('');
    if (html !== renderedMessages) {
      messages.innerHTML = html; // HTML rendered by VS Code's markdown engine in the extension; the CSP blocks scripts.
      renderedMessages = html;
      messages.scrollTop = messages.scrollHeight;
    }

    busy = state.busy;
    input.hidden = busy;
    hint.hidden = busy || state.messages.length > 0;
    stopButton.hidden = !busy;
    status.hidden = !state.status;
    if (state.status) {
      statusText.textContent = state.status.text;
      status.classList.toggle('error', state.status.kind === 'error');
      spinner.hidden = state.status.kind !== 'progress';
      // An error or result line sits above the input, which stays usable.
      input.hidden = state.status.kind === 'progress';
    }
    if (!input.hidden && state.focus) input.focus();
    autosize();
  }

  input.addEventListener('input', () => {
    autosize();
    vscode.postMessage({ type: 'draft', text: input.value });
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      const text = input.value.trim();
      if (text && !busy) {
        input.value = '';
        vscode.postMessage({ type: 'submit', text });
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      vscode.postMessage({ type: busy ? 'cancel' : 'close' });
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target !== input) {
      vscode.postMessage({ type: busy ? 'cancel' : 'close' });
    }
  });

  stopButton.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'state') {
      if (typeof message.state.draft === 'string' && input.value === '') input.value = message.state.draft;
      render(message.state);
    } else if (message.type === 'focus') {
      input.focus();
    }
  });

  new ResizeObserver(reportHeight).observe(card);
  window.addEventListener('focus', () => !input.hidden && input.focus());
  vscode.postMessage({ type: 'ready' });
  input.focus();
})();
