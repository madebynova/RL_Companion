const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const clientSource = fs.readFileSync(path.join(__dirname, "stats-api.js"), "utf8");
const diagnosticsSource = fs.readFileSync(
  path.join(__dirname, "lifecycle-diagnostics.js"),
  "utf8",
);

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, callback) {
    (this.listeners[type] ||= []).push(callback);
  }

  emit(type, event = {}) {
    for (const callback of this.listeners[type] || []) {
      callback(event);
    }
  }

  close(code, reason) {
    this.closeArgs = { code, reason };
  }
}

function createDiagnostics(enabled = false) {
  const window = {};
  vm.runInNewContext(diagnosticsSource, {
    window,
    localStorage: new MemoryStorage(),
  });
  if (enabled) {
    window.RLLifecycleDiagnostics.setEnabled(true);
  }
  return window.RLLifecycleDiagnostics;
}

function createClient(diagnostics = null) {
  FakeWebSocket.instances = [];
  let nextTimerId = 1;
  const timers = new Map();
  const window = {
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  if (diagnostics) {
    window.RLLifecycleDiagnostics = diagnostics;
  }

  vm.runInNewContext(clientSource, { window, WebSocket: FakeWebSocket, JSON, Error, Math });

  return {
    api: window.RLStatsAPI,
    sockets: FakeWebSocket.instances,
    timers,
    runNextTimer() {
      const next = timers.entries().next();
      assert.equal(next.done, false, "expected a retry timer");
      const [id, timer] = next.value;
      timers.delete(id);
      timer.callback();
      return timer.delay;
    },
  };
}

function createHandlers() {
  const handlers = {
    statuses: [],
    events: [],
    errors: [],
  };
  handlers.onStatus = (status) => handlers.statuses.push(status);
  handlers.onEvent = (event) => handlers.events.push(event);
  handlers.onError = (message) => handlers.errors.push(message);
  return handlers;
}

test("retries until Rocket League starts, then connects automatically", () => {
  const client = createClient();
  const handlers = createHandlers();

  client.api.connect(handlers);
  assert.equal(client.sockets.length, 1);
  assert.equal(client.sockets[0].url, "ws://127.0.0.1:49124");
  client.sockets[0].emit("error");
  client.sockets[0].emit("close");

  assert.equal(handlers.statuses.at(-1).status, "waiting");
  assert.match(handlers.statuses.at(-1).message, /Waiting for Rocket League/);
  assert.equal(client.runNextTimer(), 1500);
  assert.equal(client.sockets.length, 2);

  client.sockets[1].emit("open");
  assert.equal(handlers.statuses.at(-1).status, "connected");
});

test("reports game shutdown and retries after the socket closes", () => {
  const client = createClient();
  const handlers = createHandlers();
  client.api.connect(handlers);
  client.sockets[0].emit("open");

  client.sockets[0].emit("close");

  assert.equal(handlers.statuses.at(-1).status, "waiting");
  assert.match(handlers.statuses.at(-1).message, /Checking the Stats API again/);
  client.runNextTimer();
  assert.equal(client.sockets.length, 2);
  assert.equal(handlers.statuses.at(-1).status, "connecting");
});

test("prevents duplicate sockets and ignores events from a stale socket", () => {
  const client = createClient();
  const handlers = createHandlers();
  client.api.connect(handlers);
  client.api.connect(handlers);
  assert.equal(client.sockets.length, 1);

  const staleSocket = client.sockets[0];
  staleSocket.emit("close");
  client.api.connect(handlers);
  assert.equal(client.sockets.length, 2);

  staleSocket.emit("close");
  staleSocket.emit("message", { data: '{"Event":"Game:MatchCreated","Data":{}}' });
  client.api.connect(handlers);
  assert.equal(client.sockets.length, 2);
  assert.equal(handlers.events.length, 0);

  client.sockets[1].emit("open");
  client.sockets[1].emit("message", { data: '{"Event":"Game:MatchCreated","Data":{}}' });
  assert.equal(handlers.events.length, 1);
});

test("manual disconnect cancels retries and leaves reconnection available on demand", () => {
  const client = createClient();
  const handlers = createHandlers();
  client.api.connect(handlers);
  client.sockets[0].emit("close");
  assert.equal(client.timers.size, 1);

  client.api.disconnect();
  assert.equal(client.timers.size, 0);
  assert.equal(handlers.statuses.at(-1).status, "disconnected");

  client.api.connect(handlers);
  assert.equal(client.sockets.length, 2);
});

test("records socket and match event ordering while keeping diagnostic collection opt-in", () => {
  const disabledDiagnostics = createDiagnostics();
  const disabledClient = createClient(disabledDiagnostics);
  const disabledHandlers = createHandlers();
  disabledClient.api.connect(disabledHandlers);
  disabledClient.sockets[0].emit("open");
  disabledClient.sockets[0].emit("message", {
    data: '{"Event":"Game:MatchCreated","Data":{}}',
  });
  assert.equal(disabledHandlers.events.length, 1);
  assert.equal(disabledDiagnostics.getEntries().length, 0);

  const diagnostics = createDiagnostics(true);
  const client = createClient(diagnostics);
  const handlers = createHandlers();
  client.api.connect(handlers);
  client.sockets[0].emit("open");
  [
    { Event: "Game:MatchCreated", Data: { privateIdentifier: "private-id" } },
    { Event: "Game:MatchEnded", Data: { WinnerTeamNum: 0 } },
    { Event: "Game:MatchDestroyed", Data: {} },
  ].forEach((message) => {
    client.sockets[0].emit("message", { data: JSON.stringify(message) });
  });
  client.sockets[0].emit("close");
  client.runNextTimer();
  client.sockets[1].emit("open");

  const entries = Array.from(diagnostics.getEntries());
  assert.deepEqual(entries.map((entry) => entry.eventName), [
    "WebSocket:Connected",
    "Game:MatchCreated",
    "Game:MatchEnded",
    "Game:MatchDestroyed",
    "WebSocket:Disconnected",
    "WebSocket:Reconnected",
  ]);
  assert.equal(handlers.events.length, 3);
  assert.equal(diagnostics.serialize().includes("private-id"), false);
});

test("diagnostic failures do not interrupt Stats API event delivery", () => {
  const diagnostics = {
    recordConnection() {
      throw new Error("storage detail");
    },
    recordStatsEvent() {
      throw new Error("private diagnostic detail");
    },
  };
  const client = createClient(diagnostics);
  const handlers = createHandlers();
  client.api.connect(handlers);
  client.sockets[0].emit("open");
  client.sockets[0].emit("message", {
    data: '{"Event":"MatchCreated","Data":{}}',
  });

  assert.equal(handlers.events.length, 1);
  assert.deepEqual(handlers.errors, [
    "Local lifecycle diagnostics failed; the Stats API connection continues.",
    "Local lifecycle diagnostics failed; match tracking continues.",
  ]);
});
