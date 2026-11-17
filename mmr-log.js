const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const MATCHMAKING_BLOCK_SECONDS = 10;
const MAX_CONFIRMED_MMR = 9999;
const execFileAsync = promisify(execFile);

async function isRocketLeagueRunning() {
  if (process.platform !== "win32") {
    return true;
  }
  const { stdout } = await execFileAsync(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq RocketLeague.exe", "/FO", "CSV", "/NH"],
    { windowsHide: true },
  );
  return stdout.split(/\r?\n/).some((line) => /^"RocketLeague\.exe",/i.test(line));
}

function hashIdentifier(identifier) {
  return crypto.createHash("sha256").update(identifier).digest("hex");
}

function parseLogTimestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) {
    return null;
  }
  const timestamp = Date.parse(`${match[1]}T${match[2]}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseAccountLine(line) {
  const match = /HandleLocalPlayerLoginStatusChanged PlayerName=(.*?) PlayerID=(\S+) LoginStatus=(\S+) IsPrimary=(True|False)/.exec(line);
  if (!match || match[4] !== "True") {
    return null;
  }

  if (match[3] !== "LS_LoggedIn") {
    return { type: "account", account: null };
  }

  const platform = match[2].split("|")[0];
  if (!platform || !match[2].includes("|")) {
    return null;
  }
  return {
    type: "account",
    account: {
      fingerprint: hashIdentifier(match[2]),
      platform,
      displayName: match[1],
    },
  };
}

function parseMatchmakingStart(line) {
  const match = /Matchmaking: StartMatchmaking at (\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?) .*?for playlists ([\d,\s]+) on game server/.exec(line);
  if (!match) {
    return null;
  }
  return {
    timestamp: parseLogTimestamp(match[1]),
    playlistIds: match[2].split(/[,\s]+/).filter(Boolean).map(Number),
  };
}

function createMmrSample({ block, account, logSessionId }) {
  if (!account || !block || !Number.isInteger(block.selectedCount) || !block.start) {
    return null;
  }
  if (
    block.start.playlistIds.length !== 1
    || block.start.playlistIds[0] !== 11
    || block.selectedCount !== 1
    || block.partySize !== 1
    || !Number.isFinite(block.rawPartyLeaderMmr)
    || block.rawPartyLeaderMmr <= 0
  ) {
    return null;
  }

  const calculatedMmr = Number(((block.rawPartyLeaderMmr * 20) + 100).toFixed(3));
  if (!Number.isFinite(calculatedMmr) || calculatedMmr < 100 || calculatedMmr > MAX_CONFIRMED_MMR) {
    return null;
  }

  const roundedMmr = Math.round(calculatedMmr * 10) / 10;
  const sampleParts = [
    account.fingerprint,
    logSessionId,
    block.elapsedSeconds,
    block.start.timestamp,
    block.rawPartyLeaderMmr,
    block.start.playlistIds[0],
  ];

  return {
    type: "sample",
    sampleId: hashIdentifier(JSON.stringify(sampleParts)),
    accountFingerprint: account.fingerprint,
    platform: account.platform,
    playlistId: 11,
    rawPartyLeaderMmr: block.rawPartyLeaderMmr,
    calculatedMmr,
    mmr: roundedMmr,
    observedAt: new Date(block.start.timestamp).toISOString(),
    partySize: block.partySize,
  };
}

class MatchmakingLogParser {
  constructor({ logSessionId = "unknown-session" } = {}) {
    this.logSessionId = logSessionId;
    this.account = null;
    this.block = null;
  }

  resetPendingBlock() {
    this.block = null;
  }

  feedLine(line) {
    const events = [];
    const accountEvent = parseAccountLine(line);
    if (accountEvent) {
      this.account = accountEvent.account;
      events.push({
        type: "account",
        account: this.account,
      });
    }

    const elapsedMatch = /^\[(\d+(?:\.\d+)?)\]/.exec(line);
    const elapsedSeconds = elapsedMatch ? Number(elapsedMatch[1]) : null;

    if (/Matchmaking: OnlineGameMatchmaking_X::RecordStart/.test(line)) {
      this.block = { elapsedSeconds };
      return events;
    }

    const mmrMatch = /Matchmaking: Pre-divide PartyLeaderMMR: (-?\d+(?:\.\d+)?)/.exec(line);
    if (mmrMatch) {
      this.block = {
        elapsedSeconds,
        rawPartyLeaderMmr: Number(mmrMatch[1]),
      };
      return events;
    }

    if (!this.block || elapsedSeconds === null || this.block.elapsedSeconds === null) {
      return events;
    }
    if (Math.abs(elapsedSeconds - this.block.elapsedSeconds) > MATCHMAKING_BLOCK_SECONDS) {
      this.block = null;
      return events;
    }

    const matchmakingStart = parseMatchmakingStart(line);
    if (matchmakingStart) {
      this.block.start = matchmakingStart;
      return events;
    }

    const selectedMatch = /PreferredPlaylists\.Length=\((\d+)\) Party\.GetOrderedPartyMemberIDs\(\)\.Length=\((\d+)\)/.exec(line);
    if (selectedMatch) {
      this.block.selectedCount = Number(selectedMatch[1]);
      this.block.partySize = Number(selectedMatch[2]);
      const completedBlock = this.block;
      const sample = createMmrSample({
        block: completedBlock,
        account: this.account,
        logSessionId: this.logSessionId,
      });
      this.block = null;
      if (sample) {
        events.push(sample);
      } else {
        const reason = completedBlock.partySize > 1
          ? "Party matchmaking was detected. Exact MMR is not saved because the party leader cannot be verified."
          : "This matchmaking block did not meet the confirmed solo Ranked 2v2 requirements.";
        events.push({ type: "rejected", reason });
      }
    }

    return events;
  }
}

function getDefaultLogPath() {
  return path.join(
    os.homedir(),
    "Documents",
    "My Games",
    "Rocket League",
    "TAGame",
    "Logs",
    "Launch.log",
  );
}

function getFileIdentity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
}

class LaunchLogWatcher extends EventEmitter {
  constructor({
    logPath = process.env.RL_LAUNCH_LOG || getDefaultLogPath(),
    pollMs = 500,
    gameCheckMs = 5000,
    isGameRunning = isRocketLeagueRunning,
  } = {}) {
    super();
    this.logPath = logPath;
    this.pollMs = pollMs;
    this.gameCheckMs = gameCheckMs;
    this.isGameRunning = isGameRunning;
    this.lastGameCheckAt = 0;
    this.gameRunning = null;
    this.offset = 0;
    this.partialLine = "";
    this.fileIdentity = null;
    this.parser = new MatchmakingLogParser();
    this.status = { status: "waiting-for-game", message: "Waiting for Rocket League's Launch.log." };
    this.timer = null;
    this.polling = false;
  }

  async start() {
    if (this.timer) {
      return;
    }

    await this.initializeFromExistingLog();
    this.timer = setInterval(() => {
      this.poll().catch((error) => this.reportReadError(error));
    }, this.pollMs);
    this.timer.unref?.();
  }

  async initializeFromExistingLog() {
    if (!(await this.checkGameRunning())) {
      this.setStatus("waiting-for-game", "Waiting for Rocket League to start.");
      return;
    }

    let stats;
    try {
      stats = await fs.promises.stat(this.logPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        this.setStatus("waiting-for-game", "Waiting for Rocket League's Launch.log.");
        return;
      }
      this.reportReadError(error);
      return;
    }

    try {
      const existingContents = await fs.promises.readFile(this.logPath, "utf8");
      this.parser.logSessionId = `${stats.birthtimeMs}:${stats.size}`;
      const lines = existingContents.split(/\r?\n/);
      this.partialLine = lines.pop() || "";
      lines.forEach((line) => {
        this.parser.feedLine(line);
      });
      this.parser.resetPendingBlock();
      this.offset = stats.size;
      this.fileIdentity = getFileIdentity(stats);
      this.setStatus("waiting-for-matchmaking", "Rocket League is running. Waiting for a solo Ranked 2v2 matchmaking sample.");
      this.emit("account", this.parser.account);
    } catch (error) {
      this.reportReadError(error);
    }
  }

  async checkGameRunning() {
    const now = Date.now();
    if (
      this.gameRunning === null
      || now - this.lastGameCheckAt >= this.gameCheckMs
    ) {
      this.gameRunning = await this.isGameRunning();
      this.lastGameCheckAt = now;
    }
    return this.gameRunning;
  }

  setStatus(status, message) {
    if (this.status.status === status && this.status.message === message) {
      return;
    }
    this.status = { status, message };
    this.emit("status", this.status);
  }

  reportReadError(error) {
    this.setStatus("error-reading-log", `Could not monitor Rocket League: ${error.message}`);
    this.emit("readError", error);
  }

  async poll() {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      if (!(await this.checkGameRunning())) {
        this.setStatus("waiting-for-game", "Waiting for Rocket League to start.");
        return;
      }

      let stats;
      try {
        stats = await fs.promises.stat(this.logPath);
      } catch (error) {
        if (error.code === "ENOENT") {
          this.offset = 0;
          this.partialLine = "";
          this.fileIdentity = null;
          this.parser.resetPendingBlock();
          this.setStatus("waiting-for-game", "Waiting for Rocket League's Launch.log.");
          return;
        }
        throw error;
      }

      const identity = getFileIdentity(stats);
      const replaced = this.fileIdentity !== null && identity !== this.fileIdentity;
      const truncated = stats.size < this.offset;
      if (this.fileIdentity === null || replaced || truncated) {
        this.offset = 0;
        this.partialLine = "";
        this.parser = new MatchmakingLogParser({
          logSessionId: `${stats.birthtimeMs}:${stats.size}`,
        });
        this.fileIdentity = identity;
      }
      if (stats.size <= this.offset) {
        if (!["mmr-detected", "party-leader-unverified"].includes(this.status.status)) {
          this.setStatus(
            "waiting-for-matchmaking",
            "Rocket League is running. Waiting for a solo Ranked 2v2 matchmaking sample.",
          );
        }
        return;
      }

      const file = await fs.promises.open(this.logPath, "r");
      try {
        const length = stats.size - this.offset;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, this.offset);
        this.offset += bytesRead;
        const lines = (this.partialLine + buffer.toString("utf8", 0, bytesRead)).split(/\r?\n/);
        this.partialLine = lines.pop() || "";
        lines.forEach((line) => {
          const events = this.parser.feedLine(line);
          events.forEach((event) => {
            if (event.type === "account") {
              this.emit("account", event.account);
            } else if (event.type === "sample") {
              this.setStatus("mmr-detected", "A valid solo Ranked 2v2 MMR sample was detected.");
              this.emit("sample", event);
            } else if (event.type === "rejected") {
              if (event.reason.includes("party leader cannot be verified")) {
                this.setStatus("party-leader-unverified", event.reason);
              }
              this.emit("rejected", event);
            }
          });
        });
      } finally {
        await file.close();
      }

      if (!["mmr-detected", "party-leader-unverified"].includes(this.status.status)) {
        this.setStatus(
          "waiting-for-matchmaking",
          "Rocket League is running. Waiting for a solo Ranked 2v2 matchmaking sample.",
        );
      }
    } catch (error) {
      this.reportReadError(error);
    } finally {
      this.polling = false;
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  LaunchLogWatcher,
  MatchmakingLogParser,
  getDefaultLogPath,
  parseLogTimestamp,
};
