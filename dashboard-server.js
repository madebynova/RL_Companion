const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
// Keep this stable: the MMR helper only allows the matching dashboard origin.
const PORT = 4176;
const FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/lifecycle-diagnostics.js", ["lifecycle-diagnostics.js", "text/javascript; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/match-tracker.js", ["match-tracker.js", "text/javascript; charset=utf-8"]],
  ["/rank-progress.js", ["rank-progress.js", "text/javascript; charset=utf-8"]],
  ["/rank-thresholds.js", ["rank-thresholds.js", "text/javascript; charset=utf-8"]],
  ["/mmr-bridge.js", ["mmr-bridge.js", "text/javascript; charset=utf-8"]],
  ["/stats-api.js", ["stats-api.js", "text/javascript; charset=utf-8"]],
]);

function createDashboardServer({
  port = PORT,
  root = __dirname,
  shutdownToken = process.env.RL_COMPANION_SHUTDOWN_TOKEN,
} = {}) {
  let stopPromise = null;
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/__shutdown") {
      if (!shutdownToken || request.headers["x-rl-companion-token"] !== shutdownToken) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(202, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Shutting down.");
      setImmediate(() => {
        stop().catch((error) => {
          console.error(`Dashboard server shutdown failed: ${error.message}`);
          process.exitCode = 1;
        });
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url, `http://${HOST}`).pathname;
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const file = FILES.get(pathname);
    if (!file) {
      response.writeHead(404);
      response.end("Not found.");
      return;
    }

    const [fileName, contentType] = file;
    fs.readFile(path.join(root, fileName), (error, contents) => {
      if (error) {
        response.writeHead(500);
        response.end("Could not read the dashboard file.");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    });
  });

  function start() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(port, HOST, () => {
        server.removeListener("error", onError);
        resolve(server.address());
      });
    });
  }

  function stop() {
    if (!stopPromise) {
      stopPromise = new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    return stopPromise;
  }

  return { server, start, stop };
}

if (require.main === module) {
  const dashboard = createDashboardServer();
  dashboard.start().then((address) => {
    console.log(`RL COMPANION dashboard listening on http://${HOST}:${address.port}`);
  }).catch((error) => {
    console.error(`Dashboard server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createDashboardServer,
};
