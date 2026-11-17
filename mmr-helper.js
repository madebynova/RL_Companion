const http = require("node:http");
const { LaunchLogWatcher } = require("./mmr-log");

const HOST = "127.0.0.1";
const PORT = Number(process.env.RL_MMR_HELPER_PORT) || 49125;
const DEFAULT_ORIGIN = process.env.RL_COMPANION_ORIGIN || "http://127.0.0.1:4176";

function parseArguments(args) {
  const originIndex = args.indexOf("--origin");
  return originIndex >= 0 ? args[originIndex + 1] : DEFAULT_ORIGIN;
}

function validateAllowedOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Provide a valid Live Server origin using --origin.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.origin !== origin
  ) {
    throw new Error("The allowed origin must be an exact localhost or 127.0.0.1 origin.");
  }
  return parsed.origin;
}

function writeEvent(response, eventName, data) {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createMmrHelperServer({
  watcher,
  allowedOrigin,
  port = PORT,
  shutdownToken = process.env.RL_COMPANION_SHUTDOWN_TOKEN,
} = {}) {
  if (!watcher) {
    throw new Error("A LaunchLogWatcher is required.");
  }
  const origin = validateAllowedOrigin(allowedOrigin || DEFAULT_ORIGIN);
  const clients = new Set();
  let listeningServer;
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
          console.error(`MMR helper shutdown failed: ${error.message}`);
          process.exitCode = 1;
        });
      });
      return;
    }

    if (request.headers.origin !== origin) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Origin not allowed.");
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method !== "GET" || request.url !== "/events") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.write(": connected\n\n");
    clients.add(response);
    writeEvent(response, "status", watcher.status);
    if (watcher.parser.account) {
      writeEvent(response, "account", watcher.parser.account);
    }
    request.on("close", () => clients.delete(response));
  });

  const broadcast = (eventName, data) => {
    clients.forEach((client) => {
      if (!client.destroyed) {
        writeEvent(client, eventName, data);
      }
    });
  };
  const onStatus = (status) => broadcast("status", status);
  const onAccount = (account) => broadcast("account", account);
  const onSample = (sample) => broadcast("sample", sample);
  const onRejected = (event) => broadcast("rejected", event);
  const onReadError = (error) => broadcast("status", {
    status: "error-reading-log",
    message: `Could not read Rocket League's Launch.log: ${error.message}`,
  });

  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = (async () => {
      watcher.stop();
      watcher.removeListener("status", onStatus);
      watcher.removeListener("account", onAccount);
      watcher.removeListener("sample", onSample);
      watcher.removeListener("rejected", onRejected);
      watcher.removeListener("readError", onReadError);
      clients.forEach((client) => client.end());
      clients.clear();
      if (listeningServer) {
        await new Promise((resolve, reject) => {
          listeningServer.close((error) => error ? reject(error) : resolve());
        });
        listeningServer = null;
      }
    })();
    return stopPromise;
  }

  watcher.on("status", onStatus);
  watcher.on("account", onAccount);
  watcher.on("sample", onSample);
  watcher.on("rejected", onRejected);
  watcher.on("readError", onReadError);

  return {
    server,
    async start() {
      await watcher.start();
      await new Promise((resolve, reject) => {
        const onErrorOnce = (error) => reject(error);
        server.once("error", onErrorOnce);
        server.listen(port, HOST, () => {
          server.removeListener("error", onErrorOnce);
          listeningServer = server;
          resolve();
        });
      });
      return server.address();
    },
    stop,
  };
}

if (require.main === module) {
  const allowedOrigin = parseArguments(process.argv.slice(2));
  const watcher = new LaunchLogWatcher();
  const helper = createMmrHelperServer({ watcher, allowedOrigin });
  helper.start().then((address) => {
    console.log(`RL COMPANION MMR helper listening on http://${HOST}:${address.port}`);
    console.log(`Allowed dashboard origin: ${allowedOrigin}`);
  }).catch((error) => {
    console.error(`MMR helper failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createMmrHelperServer,
  validateAllowedOrigin,
};
