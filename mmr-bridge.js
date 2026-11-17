(function initializeMmrHelperBridge() {
  const HELPER_URL = window.RLMMRHelperUrl || "http://127.0.0.1:49125/events";

  let eventSource = null;
  let statusHandler = () => {};
  let accountHandler = () => {};
  let sampleHandler = () => {};
  let rejectedHandler = () => {};
  let errorHandler = () => {};

  function reportStatus(status, message) {
    statusHandler({ status, message });
  }

  function readEvent(event, handler) {
    try {
      handler(JSON.parse(event.data));
    } catch {
      errorHandler("The local MMR helper sent an invalid event.");
    }
  }

  function connect(handlers = {}) {
    statusHandler = handlers.onStatus || statusHandler;
    accountHandler = handlers.onAccount || accountHandler;
    sampleHandler = handlers.onSample || sampleHandler;
    rejectedHandler = handlers.onRejected || rejectedHandler;
    errorHandler = handlers.onError || errorHandler;
    if (eventSource) {
      return;
    }

    reportStatus("connecting-helper", "Connecting to the local MMR helper.");
    try {
      eventSource = new EventSource(HELPER_URL);
    } catch {
      eventSource = null;
      reportStatus(
        "helper-unavailable",
        "Local helper unavailable. From the project folder run: node .\\mmr-helper.js --origin http://127.0.0.1:4176",
      );
      return;
    }

    eventSource.addEventListener("open", () => {
      reportStatus("helper-connected", "Connected to the local MMR helper.");
    });
    eventSource.addEventListener("status", (event) => readEvent(event, statusHandler));
    eventSource.addEventListener("account", (event) => readEvent(event, accountHandler));
    eventSource.addEventListener("sample", (event) => readEvent(event, sampleHandler));
    eventSource.addEventListener("rejected", (event) => readEvent(event, rejectedHandler));
    eventSource.onerror = () => {
      reportStatus(
        "helper-unavailable",
        "Local helper unavailable. Start or restart the Node.js MMR helper.",
      );
    };
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    reportStatus("disconnected", "Disconnected from the local MMR helper.");
  }

  window.RLMMRBridge = { connect, disconnect };
})();
