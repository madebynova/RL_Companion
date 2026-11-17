const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createDashboardServer } = require("./dashboard-server");

function request(address, { method = "GET", path = "/", token } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
      headers: token ? { "X-RL-Companion-Token": token } : {},
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}

test("serves only dashboard assets on loopback", async () => {
  const dashboard = createDashboardServer({ port: 0 });
  const address = await dashboard.start();

  try {
    assert.equal(address.address, "127.0.0.1");

    const page = await request(address);
    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    page.resume();

    const script = await request(address, { path: "/mmr-bridge.js" });
    assert.equal(script.statusCode, 200);
    script.resume();

    const diagnosticsScript = await request(address, { path: "/lifecycle-diagnostics.js" });
    assert.equal(diagnosticsScript.statusCode, 200);
    diagnosticsScript.resume();

    for (const asset of ["/rank-thresholds.js", "/rank-progress.js"]) {
      const response = await request(address, { path: asset });
      assert.equal(response.statusCode, 200);
      response.resume();
    }

    const privateServiceFile = await request(address, { path: "/mmr-helper.js" });
    assert.equal(privateServiceFile.statusCode, 404);
    privateServiceFile.resume();
  } finally {
    await dashboard.stop();
  }
});

test("requires the launcher's token to request graceful shutdown", async () => {
  const token = "test-shutdown-token";
  const dashboard = createDashboardServer({ port: 0, shutdownToken: token });
  const address = await dashboard.start();

  const unauthorized = await request(address, { method: "POST", path: "/__shutdown" });
  assert.equal(unauthorized.statusCode, 404);
  unauthorized.resume();

  const authorized = await request(address, { method: "POST", path: "/__shutdown", token });
  assert.equal(authorized.statusCode, 202);
  authorized.resume();
  await dashboard.stop();
});
