const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const diagnosticsSource = fs.readFileSync(
  path.join(__dirname, "lifecycle-diagnostics.js"),
  "utf8",
);

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
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

function createDiagnostics(storage = new MemoryStorage()) {
  const window = {};
  vm.runInNewContext(diagnosticsSource, { window, localStorage: storage });
  return { diagnostics: window.RLLifecycleDiagnostics, storage };
}

test("records lifecycle events in order with privacy-safe summaries only", () => {
  const { diagnostics } = createDiagnostics();
  diagnostics.setEnabled(true);

  diagnostics.recordStatsEvent({
    Event: "Game:MatchEnded",
    Data: {
      WinnerTeamNum: 0,
      Players: [{
        Name: "private-player-name",
        PrimaryId: "private-player-id",
      }],
      Game: {
        Teams: [{ TeamNum: 0, privateIdentifier: "private-team-id" }],
      },
      rawLogContents: "private raw Rocket League log",
    },
  }, {
    currentMatch: {
      matchGuid: "private-match-guid",
      playerInfoAvailable: true,
      teamInfoAvailable: true,
      localPlayerName: "private-player-name",
    },
  });
  diagnostics.recordStatsEvent({
    Event: "Game:MatchDestroyed",
    Data: {},
  }, {
    currentMatch: {
      matchGuid: "private-match-guid",
      playerInfoAvailable: true,
      teamInfoAvailable: true,
    },
  });

  const entries = Array.from(diagnostics.getEntries());
  assert.deepEqual(entries.map((entry) => entry.eventName), [
    "Game:MatchEnded",
    "Game:MatchDestroyed",
  ]);
  assert.equal(entries[0].matchTracked, true);
  assert.equal(entries[0].winnerPresent, true);
  assert.equal(entries[0].playersAvailable, true);
  assert.equal(entries[0].teamsAvailable, true);
  assert.equal(entries[1].matchTracked, true);
  assert.match(entries[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);

  const output = diagnostics.serialize();
  for (const privateValue of [
    "private-player-name",
    "private-player-id",
    "private-team-id",
    "private-match-guid",
    "private raw Rocket League log",
    "rawLogContents",
  ]) {
    assert.equal(output.includes(privateValue), false);
  }
  assert.equal(output.includes("WinnerTeamNum"), false);
  assert.equal(output.includes('"winnerPresent": true'), true);
});

test("diagnostics are opt-in, can be disabled, and only accept lifecycle event names", () => {
  const storage = new MemoryStorage();
  const { diagnostics } = createDiagnostics(storage);
  const event = { Event: "MatchCreated", Data: {} };

  diagnostics.recordStatsEvent(event, null);
  assert.equal(diagnostics.getEntries().length, 0);

  diagnostics.setEnabled(true);
  diagnostics.recordStatsEvent(event, null);
  diagnostics.recordStatsEvent({ Event: "private-player-identifier", Data: {} }, null);
  assert.equal(diagnostics.getEntries().length, 1);

  diagnostics.setEnabled(false);
  diagnostics.recordStatsEvent({ Event: "MatchEnded", Data: {} }, null);
  assert.equal(diagnostics.getStatus().enabled, false);
  assert.equal(diagnostics.getEntries().length, 1);

  const restored = createDiagnostics(storage).diagnostics;
  assert.equal(restored.getStatus().enabled, false);
  assert.equal(restored.getEntries().length, 1);
});

test("coalesces repeated UpdateState summaries while retaining availability changes", () => {
  const { diagnostics } = createDiagnostics();
  diagnostics.setEnabled(true);
  const update = (players, teams) => diagnostics.recordStatsEvent({
    Event: "UpdateState",
    Data: {
      Players: Array.from({ length: players }, () => ({})),
      Game: { Teams: Array.from({ length: teams }, () => ({})) },
    },
  }, { currentMatch: null });

  update(2, 2);
  update(2, 2);
  update(1, 2);

  const entries = Array.from(diagnostics.getEntries());
  assert.equal(entries.length, 2);
  assert.equal(entries[0].playerCount, 2);
  assert.equal(entries[1].playerCount, 1);
});
