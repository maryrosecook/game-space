const versionId = document.body.dataset.versionId;

if (typeof versionId === 'string' && versionId.length > 0) {
  const tokenUrl = `/games/${encodeURIComponent(versionId)}/dist/reload-token.txt`;
  let hasBaseline = false;
  let lastSeenToken = null;
  let pollInFlight = false;

  async function readToken() {
    let response;
    try {
      response = await fetch(`${tokenUrl}?t=${Date.now()}`, { cache: 'no-store' });
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    try {
      const tokenText = (await response.text()).trim();
      return tokenText.length > 0 ? tokenText : null;
    } catch {
      return null;
    }
  }

  async function checkForTokenChange() {
    if (pollInFlight) {
      return;
    }

    pollInFlight = true;
    try {
      const nextToken = await readToken();

      if (!hasBaseline) {
        hasBaseline = true;
        lastSeenToken = nextToken;
        return;
      }

      if (nextToken === null || nextToken === lastSeenToken) {
        return;
      }

      lastSeenToken = nextToken;
      window.location.reload();
    } finally {
      pollInFlight = false;
    }
  }

  void checkForTokenChange();
  setInterval(() => {
    void checkForTokenChange();
  }, 700);
}
