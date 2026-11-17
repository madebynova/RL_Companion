const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const trackerSource = fs.readFileSync(path.join(__dirname, "match-tracker.js"), "utf8");

class MemoryStorage {
  constructor(value = null) {
    this.value = value;
  }

  getItem() {
    return this.value;
  }

  setItem(_key, value) {
    this.value = value;
  }
}

function createTracker(storage = new MemoryStorage()) {
  const window = {};
  vm.runInNewContext(trackerSource, { window, localStorage: storage });
  return { tracker: window.RLMatchTracker, storage };
}

function makeRecord(id, playlistId) {
  return {
    id,
    profileId: "main",
    playedAt: "2026-01-01T10:00:00.000Z",
    playlistId,
    result: "win",
  };
}

function recordMatch(tracker, guid, playlistId) {
  const profile = { id: "main", username: "Player" };
  tracker.processEvent({ Event: "MatchCreated", Data: { MatchGuid: guid } }, profile);
  tracker.processEvent({
    Event: "UpdateState",
    Data: {
      MatchGuid: guid,
      Game: {
        PlaylistId: playlistId,
        Teams: [{ TeamNum: 0, Score: 2 }, { TeamNum: 1, Score: 1 }],
      },
      Players: [{ Name: "Player", TeamNum: 0, Goals: 1, Assists: 0, Saves: 1, Shots: 2 }],
    },
  }, profile);
  tracker.processEvent({
    Event: "MatchEnded",
    Data: { MatchGuid: guid, WinnerTeamNum: 0 },
  }, profile);
}

test("classifies only the supported Ranked and Casual playlists", () => {
  const { tracker } = createTracker();

  for (const [playlistId, teamSize] of [[10, 1], [11, 2], [13, 3]]) {
    assert.equal(tracker.getPlaylistMode(playlistId), "ranked");
    assert.equal(tracker.getPlaylistInfo(playlistId).teamSize, teamSize);
  }
  for (const playlistId of [1, 2, 3, 4]) {
    assert.equal(tracker.getPlaylistMode(playlistId), "casual");
    assert.equal(tracker.getPlaylistInfo(playlistId).teamSize, playlistId);
  }
  for (const playlistId of [0, 5, 12, 14, null, "11", undefined]) {
    assert.equal(tracker.getPlaylistMode(playlistId), null);
    assert.equal(tracker.getPlaylistInfo(playlistId), null);
  }
});

test("filters legacy records by stored playlist without rewriting saved history", () => {
  const records = [
    makeRecord("old-ranked", 10),
    makeRecord("old-casual", 1),
    makeRecord("unsupported", 99),
    { ...makeRecord("missing-playlist", undefined) },
  ];
  const original = JSON.stringify({ version: 1, records });
  const { tracker, storage } = createTracker(new MemoryStorage(original));
  tracker.initialize({});

  assert.deepEqual(Array.from(tracker.getMatches("main", "ranked"), (record) => record.id), ["old-ranked"]);
  assert.deepEqual(Array.from(tracker.getMatches("main", "casual"), (record) => record.id), ["old-casual"]);
  assert.equal(storage.value, original);
});

test("persists the Stats API playlist ID and excludes unknown playlists from both modes", () => {
  const { tracker, storage } = createTracker();
  const profile = { id: "main", username: "Player" };
  tracker.initialize({});

  recordMatch(tracker, "ranked-match", 11);
  recordMatch(tracker, "casual-match", 2);
  recordMatch(tracker, "unsupported-match", 99);

  const savedRecords = JSON.parse(storage.value).records;
  assert.deepEqual(
    savedRecords.map((record) => [record.id, record.playlistId]),
    [["unsupported-match", 99], ["casual-match", 2], ["ranked-match", 11]],
  );
  assert.deepEqual(
    Array.from(tracker.getMatches(profile.id, "ranked"), (record) => record.id),
    ["ranked-match"],
  );
  assert.deepEqual(
    Array.from(tracker.getMatches(profile.id, "casual"), (record) => record.id),
    ["casual-match"],
  );
});
