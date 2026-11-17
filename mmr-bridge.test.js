const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const bridgeSource = fs.readFileSync(path.join(__dirname, "mmr-bridge.js"), "utf8");

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  emit(name, data = {}) {
    const callback = this.listeners.get(name);
    if (callback) {
      callback({ data: JSON.stringify(data) });
    }
  }

  emitRaw(name, data) {
    const callback = this.listeners.get(name);
    if (callback) {
      callback({ data });
    }
  }

  close() {
    this.closed = true;
  }
}
FakeEventSource.instances = [];

function createBridge() {
  const window = { RLMMRHelperUrl: "http://127.0.0.1:49125/events" };
  vm.runInNewContext(bridgeSource, { window, EventSource: FakeEventSource, JSON });
  return window.RLMMRBridge;
}

test("connects once, forwards helper events, and closes cleanly", () => {
  FakeEventSource.instances = [];
  const bridge = createBridge();
  const events = [];
  bridge.connect({
    onStatus: (value) => events.push(["status", value.status]),
    onAccount: (value) => events.push(["account", value.fingerprint]),
    onSample: (value) => events.push(["sample", value.mmr]),
    onRejected: (value) => events.push(["rejected", value.reason]),
  });
  bridge.connect();

  assert.equal(FakeEventSource.instances.length, 1);
  const source = FakeEventSource.instances[0];
  assert.equal(source.url, "http://127.0.0.1:49125/events");
  source.emit("open");
  source.emit("account", { fingerprint: "a".repeat(64) });
  source.emit("sample", { mmr: 1408.2 });
  source.emit("rejected", { reason: "unverified party leader" });

  bridge.disconnect();

  assert.equal(source.closed, true);
  assert.deepEqual(events, [
    ["status", "connecting-helper"],
    ["status", "helper-connected"],
    ["account", "a".repeat(64)],
    ["sample", 1408.2],
    ["rejected", "unverified party leader"],
    ["status", "disconnected"],
  ]);
});

test("reports invalid events and helper disconnections", () => {
  FakeEventSource.instances = [];
  const bridge = createBridge();
  const statuses = [];
  const errors = [];
  bridge.connect({
    onStatus: (value) => statuses.push(value.status),
    onError: (message) => errors.push(message),
  });
  const source = FakeEventSource.instances[0];
  source.emitRaw("sample", "not-json");
  source.onerror();

  assert.deepEqual(errors, ["The local MMR helper sent an invalid event."]);
  assert.deepEqual(statuses, ["connecting-helper", "helper-unavailable"]);
});
