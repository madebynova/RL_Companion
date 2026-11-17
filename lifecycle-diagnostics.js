(function initializeRLLifecycleDiagnostics() {
  const STORAGE_KEY = "rl-companion.lifecycle-diagnostics.v1";
  const ENABLED_KEY = "rl-companion.lifecycle-diagnostics.enabled.v1";
  const MAX_ENTRIES = 2000;
  const MATCH_EVENTS = new Set([
    "MatchCreated",
    "Game:MatchCreated",
    "MatchInitialized",
    "Game:MatchInitialized",
    "CountdownBegin",
    "Game:CountdownBegin",
    "RoundStarted",
    "Game:RoundStarted",
    "UpdateState",
    "Game:UpdateState",
    "GoalScored",
    "Game:GoalScored",
    "MatchEnded",
    "Game:MatchEnded",
    "MatchDestroyed",
    "Game:MatchDestroyed",
  ]);
  const CONNECTION_EVENTS = {
    connected: "WebSocket:Connected",
    disconnected: "WebSocket:Disconnected",
    reconnected: "WebSocket:Reconnected",
  };

  let enabled = false;
  let entries = [];
  let storageError = "";
  let lastUpdateStateSignature = null;
  let onChange = () => {};

  function reportChange() {
    onChange(getStatus());
  }

  function setStorageError(message) {
    enabled = false;
    storageError = message;
    try {
      localStorage.setItem(ENABLED_KEY, "false");
    } catch {
      // The visible status still reports the original storage failure.
    }
    reportChange();
  }

  function sanitizeEntry(entry) {
    if (!entry || typeof entry !== "object" || typeof entry.timestamp !== "string") {
      return null;
    }
    const parsedTimestamp = Date.parse(entry.timestamp);
    if (Number.isNaN(parsedTimestamp)) {
      return null;
    }
    const timestamp = new Date(parsedTimestamp).toISOString();
    if (entry.type === "websocket") {
      if (!Object.values(CONNECTION_EVENTS).includes(entry.eventName)) {
        return null;
      }
      return {
        timestamp,
        type: "websocket",
        eventName: entry.eventName,
        matchTracked: entry.matchTracked === true,
      };
    }
    if (entry.type !== "stats-event" || !MATCH_EVENTS.has(entry.eventName)) {
      return null;
    }
    return {
      timestamp,
      type: "stats-event",
      eventName: entry.eventName,
      matchTracked: entry.matchTracked === true,
      winnerPresent: entry.winnerPresent === true,
      playersAvailable: entry.playersAvailable === true,
      teamsAvailable: entry.teamsAvailable === true,
      playerCount: Number.isInteger(entry.playerCount)
        ? Math.max(0, Math.min(entry.playerCount, 32))
        : null,
      teamCount: Number.isInteger(entry.teamCount)
        ? Math.max(0, Math.min(entry.teamCount, 8))
        : null,
    };
  }

  function loadStoredState() {
    try {
      const preference = localStorage.getItem(ENABLED_KEY);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
          storageError = "Saved lifecycle diagnostics could not be validated; stored data was left untouched.";
        } else {
          entries = parsed.entries
            .map(sanitizeEntry)
            .filter(Boolean)
            .slice(-MAX_ENTRIES);
        }
      }
      enabled = preference === "true" && !storageError;
    } catch {
      enabled = false;
      storageError = "Local browser storage is unavailable; lifecycle diagnostics are disabled.";
    }
  }

  function persistEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
      reportChange();
      return true;
    } catch {
      setStorageError("Lifecycle diagnostics could not be saved in this browser; recording has been disabled.");
      return false;
    }
  }

  function appendEntry(entry) {
    if (!enabled) {
      return;
    }
    const safeEntry = sanitizeEntry(entry);
    if (!safeEntry) {
      return;
    }
    const previousEntries = entries;
    entries = entries.concat(safeEntry).slice(-MAX_ENTRIES);
    if (!persistEntries()) {
      entries = previousEntries;
      reportChange();
    }
  }

  function getTrackedMatchState() {
    return {
      matchTracked: false,
      playersAvailable: false,
      teamsAvailable: false,
    };
  }

  function recordStatsEvent(event, trackerSnapshot) {
    if (!enabled || !event || !MATCH_EVENTS.has(event.Event)) {
      return;
    }

    const data = event.Data && typeof event.Data === "object" ? event.Data : {};
    const game = data.Game && typeof data.Game === "object" ? data.Game : {};
    const players = Array.isArray(data.Players) ? data.Players : null;
    const teams = Array.isArray(game.Teams) ? game.Teams : null;
    const currentMatch = trackerSnapshot && trackerSnapshot.currentMatch;
    const trackedState = getTrackedMatchState();
    trackedState.matchTracked = Boolean(currentMatch);
    trackedState.playersAvailable =
      Boolean(currentMatch && currentMatch.playerInfoAvailable)
      || Boolean(players && players.some((player) => player && typeof player === "object"));
    trackedState.teamsAvailable =
      Boolean(currentMatch && currentMatch.teamInfoAvailable)
      || Boolean(teams && teams.some((team) => team && typeof team === "object"));

    const entry = {
      timestamp: new Date().toISOString(),
      type: "stats-event",
      eventName: event.Event,
      matchTracked: trackedState.matchTracked,
      winnerPresent: Object.prototype.hasOwnProperty.call(data, "WinnerTeamNum"),
      playersAvailable: trackedState.playersAvailable,
      teamsAvailable: trackedState.teamsAvailable,
      playerCount: players ? players.length : null,
      teamCount: teams ? teams.length : null,
    };

    if (event.Event === "UpdateState" || event.Event === "Game:UpdateState") {
      const signature = JSON.stringify({
        matchTracked: entry.matchTracked,
        winnerPresent: entry.winnerPresent,
        playersAvailable: entry.playersAvailable,
        teamsAvailable: entry.teamsAvailable,
        playerCount: entry.playerCount,
        teamCount: entry.teamCount,
      });
      if (signature === lastUpdateStateSignature) {
        return;
      }
      lastUpdateStateSignature = signature;
    } else if (
      event.Event === "MatchCreated"
      || event.Event === "Game:MatchCreated"
      || event.Event === "MatchDestroyed"
      || event.Event === "Game:MatchDestroyed"
    ) {
      lastUpdateStateSignature = null;
    }

    appendEntry(entry);
  }

  function recordConnection(eventName, trackerSnapshot) {
    if (!Object.prototype.hasOwnProperty.call(CONNECTION_EVENTS, eventName)) {
      return;
    }
    appendEntry({
      timestamp: new Date().toISOString(),
      type: "websocket",
      eventName: CONNECTION_EVENTS[eventName],
      matchTracked: Boolean(trackerSnapshot && trackerSnapshot.currentMatch),
    });
  }

  function setEnabled(value) {
    if (!value) {
      enabled = false;
      try {
        localStorage.setItem(ENABLED_KEY, "false");
      } catch {
        storageError = "The diagnostics setting could not be saved; recording is disabled for this page.";
      }
      reportChange();
      return getStatus();
    }
    if (storageError) {
      enabled = false;
      reportChange();
      return getStatus();
    }
    try {
      localStorage.setItem(ENABLED_KEY, "true");
      enabled = true;
      reportChange();
    } catch {
      setStorageError("The diagnostics setting could not be saved; recording remains disabled.");
    }
    return getStatus();
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      entries = [];
      reportChange();
      return true;
    } catch {
      storageError = "Lifecycle diagnostics could not be cleared from this browser.";
      reportChange();
      return false;
    }
  }

  function getStatus() {
    return { enabled, entryCount: entries.length, error: storageError };
  }

  function getEntries() {
    return entries.map((entry) => ({ ...entry }));
  }

  function serialize() {
    return JSON.stringify({ version: 1, entries: getEntries() }, null, 2);
  }

  function subscribe(handler) {
    onChange = typeof handler === "function" ? handler : () => {};
    reportChange();
  }

  loadStoredState();
  window.RLLifecycleDiagnostics = {
    clear,
    getEntries,
    getStatus,
    recordConnection,
    recordStatsEvent,
    serialize,
    setEnabled,
    subscribe,
  };
})();
