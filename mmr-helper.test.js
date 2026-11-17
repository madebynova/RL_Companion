const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createMmrHelperServer, validateAllowedOrigin } = require("./mmr-helper");

class FakeWatcher extends EventEmitter {
  constructor() {
    super();
    this.status = { status: "waiting-for-matchmaking", message: "Waiting for a sample." };
    this.parser = {
      account: {
        fingerprint: "a".repeat(64),
        platform: "Epic",
        displayName: "Read Ahead",
      },
    };
  }

  async start() {}

  stop() {}
}

function request(address, origin) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: "127.0.0.1",
      port: address.port,
      path: "/events",
      headers: { Origin: origin },
    }, resolve);
    req.on("error", reject);
  });
}

function shutdownRequest(address, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/__shutdown",
      headers: token ? { "X-RL-Companion-Token": token } : {},
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}

test("only accepts the exact configured loopback origin", () => {
  assert.equal(validateAllowedOrigin("http://127.0.0.1:4176"), "http://127.0.0.1:4176");
  assert.throws(() => validateAllowedOrigin("*"), /valid Live Server origin/);
  assert.throws(() => validateAllowedOrigin("https://example.com"), /exact localhost/);
});

test("streams structured status and samples only to the configured browser origin", async () => {
  const watcher = new FakeWatcher();
  const helper = createMmrHelperServer({
    watcher,
    allowedOrigin: "http://127.0.0.1:4176",
    port: 0,
  });

  test("requires the launcher's token to request graceful shutdown", async () => {
    const watcher = new FakeWatcher();
    const helper = createMmrHelperServer({
      watcher,
      allowedOrigin: "http://127.0.0.1:4176",
      port: 0,
      shutdownToken: "test-shutdown-token",
    });
    const address = await helper.start();

    const unauthorized = await shutdownRequest(address);
    assert.equal(unauthorized.statusCode, 404);
    unauthorized.resume();

    const authorized = await shutdownRequest(address, "test-shutdown-token");
    assert.equal(authorized.statusCode, 202);
    authorized.resume();
    await helper.stop();
    assert.equal(helper.server.listening, false);
  });
  const address = await helper.start();
  let response;
  let body = "";

  try {
    response = await request(address, "http://127.0.0.1:4176");
    assert.equal(response.statusCode, 200);
    response.on("data", (chunk) => {
      body += chunk.toString();
    });

    watcher.emit("sample", {
      type: "sample",
      sampleId: "b".repeat(64),
      playlistId: 11,
      rawPartyLeaderMmr: 65.4099,
      calculatedMmr: 1408.198,
      mmr: 1408.2,
    });
    watcher.emit("rejected", {
      reason: "Party matchmaking was detected. Exact MMR is not saved because the party leader cannot be verified.",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(body, /event: status/);
    assert.match(body, /event: account/);
    assert.match(body, /event: sample/);
    assert.match(body, /event: rejected/);
    assert.match(body, /1408\.2/);

    const rejected = await request(address, "http://example.com");
    assert.equal(rejected.statusCode, 403);
    rejected.resume();
  } finally {
    if (response) {
      response.destroy();
    }
    await helper.stop();
  }
});
