// Browser-side connection to Rocket League's documented local Stats API.
(function initializeRocketLeagueStatsAPI() {
  // Change this URL if Rocket League's WebPort is configured differently.
  const API_URL = "ws://127.0.0.1:49124";
  const MIN_RETRY_MS = 1500;
  const MAX_RETRY_MS = 10000;

  let socket = null;
  let shouldReconnect = false;
  let retryTimer = null;
  let retryDelay = MIN_RETRY_MS;
  let statusHandler = () => {};
  let eventHandler = () => {};
  let errorHandler = () => {};
  let hasConnected = false;
  let socketIsOpen = false;

  function getTrackerSnapshot() {
    const tracker = window.RLMatchTracker;
    return tracker && typeof tracker.getSnapshot === "function"
      ? tracker.getSnapshot()
      : null;
  }

  function recordConnectionDiagnostic(eventName) {
    const diagnostics = window.RLLifecycleDiagnostics;
    if (diagnostics && typeof diagnostics.recordConnection === "function") {
      try {
        diagnostics.recordConnection(eventName, getTrackerSnapshot());
      } catch {
        errorHandler("Local lifecycle diagnostics failed; the Stats API connection continues.");
      }
    }
  }

  function recordEventDiagnostic(event) {
    const diagnostics = window.RLLifecycleDiagnostics;
    if (diagnostics && typeof diagnostics.recordStatsEvent === "function") {
      try {
        diagnostics.recordStatsEvent(event, getTrackerSnapshot());
      } catch {
        errorHandler("Local lifecycle diagnostics failed; match tracking continues.");
      }
    }
  }

  function reportStatus(status, message) {
    statusHandler({ status, message });
  }

  function parseMessage(rawMessage) {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      throw new Error("Rocket League sent a message that was not valid JSON.");
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    return messages.map((message) => {
      if (!message || typeof message !== "object" || typeof message.Event !== "string") {
        throw new Error("Rocket League sent an event with an invalid envelope.");
      }

      let data = message.Data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          throw new Error(`The ${message.Event} event contained invalid JSON data.`);
        }
      }
      if (data === undefined || data === null) {
        data = {};
      }
      if (typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`The ${message.Event} event data must be an object.`);
      }
      return { Event: message.Event, Data: data };
    });
  }

  function scheduleReconnect() {
    if (!shouldReconnect || retryTimer !== null) {
      return;
    }

    const wait = retryDelay;
    retryDelay = Math.min(retryDelay * 1.7, MAX_RETRY_MS);
    reportStatus(
      "waiting",
      `Waiting for Rocket League. Checking the Stats API again in ${Math.ceil(wait / 1000)} seconds.`,
    );
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      openSocket();
    }, wait);
  }

  function openSocket() {
    if (!shouldReconnect || socket) {
      return;
    }

    reportStatus("connecting", `Checking the local Stats API at ${API_URL}…`);
    try {
      const currentSocket = new WebSocket(API_URL);
      socket = currentSocket;

      currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) {
          return;
        }
        recordConnectionDiagnostic(hasConnected ? "reconnected" : "connected");
        hasConnected = true;
        socketIsOpen = true;
        retryDelay = MIN_RETRY_MS;
        reportStatus("connected", "Connected to the local Rocket League Stats API.");
      });

      currentSocket.addEventListener("message", (event) => {
        if (socket !== currentSocket) {
          return;
        }
        try {
          const messages = parseMessage(event.data);
          messages.forEach((message) => {
            recordEventDiagnostic(message);
            eventHandler(message);
          });
        } catch (error) {
          errorHandler(error.message);
        }
      });

      currentSocket.addEventListener("error", () => {
        if (socket === currentSocket) {
          reportStatus(
            "waiting",
            "The Rocket League Stats API is not reachable. Waiting for the game and retrying automatically.",
          );
        }
      });

      currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket) {
          return;
        }
        if (socketIsOpen) {
          recordConnectionDiagnostic("disconnected");
        }
        socketIsOpen = false;
        socket = null;
        if (shouldReconnect) {
          scheduleReconnect();
        } else {
          reportStatus("disconnected", "Disconnected from the local Stats API.");
        }
      });
    } catch {
      socket = null;
      reportStatus(
        "waiting",
        "Could not open the local Stats API connection. Waiting for Rocket League and retrying automatically.",
      );
      scheduleReconnect();
    }
  }

  function connect(handlers) {
    statusHandler = handlers.onStatus || statusHandler;
    eventHandler = handlers.onEvent || eventHandler;
    errorHandler = handlers.onError || errorHandler;
    if (shouldReconnect && socket) {
      return;
    }
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    shouldReconnect = true;
    retryDelay = MIN_RETRY_MS;
    openSocket();
  }

  function disconnect() {
    shouldReconnect = false;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (socket) {
      const currentSocket = socket;
      if (socketIsOpen) {
        recordConnectionDiagnostic("disconnected");
      }
      socketIsOpen = false;
      socket = null;
      currentSocket.close(1000, "Disconnected by user");
    }
    reportStatus("disconnected", "Disconnected. Connect when Rocket League is ready.");
  }

  window.RLStatsAPI = {
    connect,
    disconnect,
    parseMessage,
  };
})();
