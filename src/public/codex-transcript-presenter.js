function formatRole(role) {
  return role === 'assistant' ? 'Assistant' : 'User';
}

function isSupportedMessage(message) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  return (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string';
}

export function createCodexTranscriptPresenter(sessionView) {
  if (!(sessionView instanceof HTMLElement)) {
    throw new Error('Codex session container is missing from the page');
  }

  function clear() {
    sessionView.replaceChildren();
  }

  function showEmptyState(title, description) {
    clear();

    const shell = document.createElement('div');
    shell.className = 'codex-empty-shell';

    const titleElement = document.createElement('h2');
    titleElement.className = 'codex-empty-title';
    titleElement.textContent = title;

    const descriptionElement = document.createElement('p');
    descriptionElement.className = 'codex-empty';
    descriptionElement.textContent = description;

    shell.append(titleElement, descriptionElement);
    sessionView.append(shell);
  }

  function showLoadingState() {
    showEmptyState('Loading transcript', 'Reading Codex session data...');
  }

  function appendSessionHeader(sessionId) {
    const header = document.createElement('header');
    header.className = 'codex-session-header';

    const heading = document.createElement('h2');
    heading.textContent = 'Transcript';

    const detail = document.createElement('code');
    detail.className = 'codex-session-id';
    detail.textContent = sessionId;

    header.append(heading, detail);
    sessionView.append(header);
  }

  function appendTranscript(messages) {
    const thread = document.createElement('div');
    thread.className = 'codex-thread';

    for (const message of messages) {
      if (!isSupportedMessage(message)) {
        continue;
      }

      const card = document.createElement('article');
      card.className = `codex-message codex-message--${message.role}`;

      const label = document.createElement('div');
      label.className = 'codex-message-role';
      label.textContent = formatRole(message.role);

      const text = document.createElement('pre');
      text.className = 'codex-message-text';
      text.textContent = message.text;

      card.append(label, text);
      thread.append(card);
    }

    if (thread.childElementCount === 0) {
      showEmptyState('No visible messages', 'This session has no user/assistant text entries yet.');
      return false;
    }

    sessionView.append(thread);
    return true;
  }

  function renderTranscript(sessionId, messages, options = {}) {
    const shouldAutoScroll = options.autoScrollToBottom === true;

    clear();
    appendSessionHeader(sessionId);

    if (!appendTranscript(messages)) {
      return;
    }

    if (shouldAutoScroll) {
      sessionView.scrollTop = sessionView.scrollHeight;
    }
  }

  return {
    clear,
    showEmptyState,
    showLoadingState,
    renderTranscript
  };
}
