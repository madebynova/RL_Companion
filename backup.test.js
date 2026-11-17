const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const rankProgress = require("./rank-progress");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
let lastBlob = null;

class TestBlob {
  constructor(parts, options) {
    this.content = parts.join("");
    this.type = options.type;
    lastBlob = this;
  }

  async text() {
    return this.content;
  }
}

class TestURL extends URL {
  static createObjectURL() {
    return "blob:test-backup";
  }

  static revokeObjectURL() {}
}

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.failKey = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failKey === key) {
      this.failKey = null;
      throw new Error("Simulated storage failure");
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.files = [];
    this.style = {};
    this._lastChild = { textContent: "" };
    this.classList = {
      values: new Set(),
      toggle(name, force) {
        if (force === undefined ? !this.values.has(name) : force) {
          this.values.add(name);
        } else {
          this.values.delete(name);
        }
      },
      add(name) {
        this.values.add(name);
      },
      remove(name) {
        this.values.delete(name);
      },
    };
  }

  get lastChild() {
    return this._lastChild;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
    this.textContent = "";
  }

  addEventListener(type, callback) {
    (this.listeners[type] ||= []).push(callback);
  }

  async dispatch(type, event = {}) {
    for (const callback of this.listeners[type] || []) {
      await callback({ preventDefault() {}, ...event, currentTarget: this });
    }
  }

  click() {
    for (const callback of this.listeners.click || []) {
      callback({ currentTarget: this });
    }
  }

  remove() {
    this.removed = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  reset() {}

  focus() {}
}

function createApp(storage, matchRecords = { ranked: [], casual: [] }) {
  const elements = new Map();
  const statsApi = {
    connectCalls: [],
    disconnectCalls: 0,
    connect(handlers) {
      this.connectCalls.push(handlers);
    },
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
  const mmrBridge = {
    handlers: null,
    connect(handlers) {
      this.handlers = handlers;
    },
    disconnect() {},
  };
  const document = {
    body: new FakeElement("body"),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, new FakeElement());
      }
      return elements.get(id);
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector() {
      return new FakeElement("button");
    },
  };
  const window = {
    location: {
      origin: "http://127.0.0.1:4176",
      reloadCount: 0,
      reload() {
        this.reloadCount += 1;
      },
    },
    setTimeout(callback) {
      this.pendingTimer = callback;
      return 1;
    },
    RLMatchTracker: {
      initialize() {},
      getMatches(profileId, mode) {
        return (matchRecords[mode] || [])
          .filter((record) => record.profileId === profileId);
      },
      getPlaylistMode(playlistId) {
        return ({
          1: "casual",
          2: "casual",
          3: "casual",
          4: "casual",
          10: "ranked",
          11: "ranked",
          13: "ranked",
        })[playlistId] || null;
      },
      getPlaylistName(playlistId) {
        return ({
          1: "Casual 1v1",
          2: "Casual 2v2",
          3: "Casual 3v3",
          4: "Casual 4v4",
          10: "Ranked 1v1",
          11: "Ranked 2v2",
          13: "Ranked 3v3",
        })[playlistId] || "Unknown";
      },
      getSnapshot() {
        return { phase: "waiting", roster: [] };
      },
    },
    RLStatsAPI: statsApi,
    RLMMRBridge: mmrBridge,
    RLRankProgress: rankProgress,
  };

  vm.runInNewContext(appSource, {
    window,
    document,
    localStorage: storage,
    URL: TestURL,
    Blob: TestBlob,
    Intl,
    Date,
    Math,
    Set,
    Map,
    JSON,
    console,
  });
  return { document, window, statsApi, mmrBridge };
}

function profile(id, username, slug, platform = "epic") {
  return {
    id,
    platform,
    username,
    nickname: username,
    profileUrl: `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${slug}/overview`,
    role: "player",
  };
}

function backup(
  profiles,
  updates,
  records = [],
  legacyProfile = null,
  activeProfileId = profiles[0] ? profiles[0].id : null,
  automaticMmrHistory,
) {
  const data = {
    profileState: { version: 2, profiles, activeProfileId },
    manualMmrHistory: { version: 1, updates },
    matchHistory: { version: 1, records },
    legacyProfile,
    settings: {},
  };
  if (automaticMmrHistory) {
    data.automaticMmrHistory = automaticMmrHistory;
  }
  return {
    format: "rl-companion-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    data,
  };
}

function automaticSample(profileId, sampleId = "b".repeat(64), updatedAt = "2026-02-01T10:00:00.000Z") {
  return {
    profileId,
    sampleId,
    playlistId: 11,
    rawPartyLeaderMmr: 65.4099,
    calculatedMmr: 1408.198,
    mmr: 1408.2,
    updatedAt,
    source: "launch-log",
  };
}

async function selectBackup(app, contents) {
  const input = app.document.getElementById("backup-file");
  input.files = [{
    size: Buffer.byteLength(contents),
    text: async () => contents,
  }];
  await input.dispatch("change");
}

function read(storage, key) {
  const contents = storage.getItem(key);
  return contents === null ? null : JSON.parse(contents);
}

test("dashboard startup automatically requests a Stats API connection", () => {
  const app = createApp(new MemoryStorage());

  assert.equal(app.statsApi.connectCalls.length, 1);
  assert.equal(app.document.getElementById("rl-connection-status").dataset.status, "waiting");
  assert.equal(typeof app.statsApi.connectCalls[0].onEvent, "function");
});

test("mode selector switches mode-specific stats and match history without reloading", async () => {
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [profile("main", "Main", "main")],
      activeProfileId: "main",
    }),
    "rl-companion.manual-mmr.v1": JSON.stringify({
      version: 1,
      updates: [{ profileId: "main", mmr: 1300, updatedAt: "2026-01-01T10:00:00.000Z" }],
    }),
  });
  const records = {
    ranked: [
      { id: "ranked-loss", profileId: "main", playlistId: 11, result: "loss", playedAt: "2026-02-02T10:00:00.000Z" },
      { id: "ranked-win", profileId: "main", playlistId: 10, result: "win", playedAt: "2026-02-01T10:00:00.000Z" },
    ],
    casual: [
      { id: "casual-win", profileId: "main", playlistId: 2, result: "win", playedAt: "2026-02-03T10:00:00.000Z" },
    ],
  };
  const app = createApp(storage, records);

  assert.equal(app.document.getElementById("page-title").textContent, "Ranked Overview");
  assert.equal(app.document.getElementById("rank-card").hidden, false);
  assert.equal(app.document.getElementById("overview-grid").classList.values.has("is-casual"), false);
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,300");
  assert.equal(app.document.getElementById("recorded-match-count").textContent, "2");
  assert.equal(app.document.getElementById("session-wins").textContent, "1");
  assert.equal(app.document.getElementById("session-losses").textContent, "1");
  assert.match(app.document.getElementById("session-summary").textContent, /50% win rate/);
  assert.equal(app.document.getElementById("match-list").children.length, 2);
  assert.equal(app.document.getElementById("match-list").children[0].children[1].textContent, "Ranked 2v2");

  await app.document.getElementById("casual-mode-button").dispatch("click");

  assert.equal(app.document.getElementById("page-title").textContent, "Casual Overview");
  assert.equal(app.document.getElementById("session-heading").textContent, "Casual statistics");
  assert.equal(app.document.getElementById("casual-mode-button").attributes["aria-pressed"], "true");
  assert.equal(app.document.getElementById("ranked-mode-button").attributes["aria-pressed"], "false");
  assert.equal(app.document.getElementById("rank-card").hidden, true);
  assert.equal(app.document.getElementById("overview-grid").classList.values.has("is-casual"), true);
  assert.equal(app.document.getElementById("overview-grid").attributes["aria-label"], "Casual session overview");
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,300");
  assert.equal(app.document.getElementById("recorded-match-count").textContent, "1");
  assert.equal(app.document.getElementById("session-wins").textContent, "1");
  assert.equal(app.document.getElementById("session-losses").textContent, "0");
  assert.match(app.document.getElementById("session-summary").textContent, /100% win rate/);
  assert.equal(app.document.getElementById("match-list").children.length, 1);
  assert.equal(app.document.getElementById("match-list").children[0].children[1].textContent, "Casual 2v2");

  await app.document.getElementById("ranked-mode-button").dispatch("click");

  assert.equal(app.document.getElementById("rank-card").hidden, false);
  assert.equal(app.document.getElementById("overview-grid").classList.values.has("is-casual"), false);
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,300");
  assert.equal(app.document.getElementById("recorded-match-count").textContent, "2");
  assert.equal(app.document.getElementById("match-list").children.length, 2);

  for (let toggle = 0; toggle < 2; toggle++) {
    await app.document.getElementById("casual-mode-button").dispatch("click");
    assert.equal(app.document.getElementById("overview-grid").classList.values.has("is-casual"), true);
    await app.document.getElementById("ranked-mode-button").dispatch("click");
    assert.equal(app.document.getElementById("overview-grid").classList.values.has("is-casual"), false);
  }
  assert.equal(app.window.location.reloadCount, 0);
});

test("cancel closes and clears an Add Profile form without changing saved data", async () => {
  for (const hasProfile of [false, true]) {
    const savedProfileState = {
      version: 2,
      profiles: hasProfile ? [profile("main", "Main", "main")] : [],
      activeProfileId: hasProfile ? "main" : null,
    };
    const storage = new MemoryStorage({
      "rl-companion.profiles.v2": JSON.stringify(savedProfileState),
      "rl-companion.manual-mmr.v1": JSON.stringify({
        version: 1,
        updates: [{ profileId: "main", mmr: 1300, updatedAt: "2026-01-01T10:00:00.000Z" }],
      }),
      "rl-companion.auto-mmr.v1": JSON.stringify({ version: 1, samples: [] }),
    });
    const originalValues = new Map(storage.values);
    const app = createApp(storage);

    app.document.getElementById("add-profile").click();
    assert.equal(app.document.getElementById("profile-form").hidden, false);
    app.document.getElementById("profile-platform").value = "steam";
    app.document.getElementById("profile-username").value = "Unfinished";
    app.document.getElementById("profile-nickname").value = "Draft";
    app.document.getElementById("profile-url").value = "https://example.invalid/profile";

    app.document.getElementById("cancel-profile-edit").click();

    assert.equal(app.document.getElementById("profile-form").hidden, true);
    assert.equal(app.document.getElementById("profile-username").value, "");
    assert.equal(app.document.getElementById("profile-nickname").value, "");
    assert.equal(app.document.getElementById("profile-url").value, "");
    assert.equal(app.document.getElementById("profile-platform").value, "epic");
    assert.deepEqual([...storage.values], [...originalValues]);
    assert.equal(read(storage, "rl-companion.profiles.v2").activeProfileId, savedProfileState.activeProfileId);

    app.document.getElementById("add-profile").click();
    assert.equal(app.document.getElementById("profile-form").hidden, false);
    assert.equal(app.document.getElementById("profile-username").value, "");
    assert.equal(app.document.getElementById("profile-nickname").value, "");
    assert.equal(app.document.getElementById("profile-url").value, "");
  }
});

test("casual mode has its own empty state", async () => {
  const app = createApp(new MemoryStorage());

  await app.document.getElementById("casual-mode-button").dispatch("click");

  assert.equal(
    app.document.getElementById("match-list").children[0].children[0].textContent,
    "No Casual matches recorded yet.",
  );
  assert.equal(app.document.getElementById("session-summary").textContent, "No completed casual matches recorded");
});

test("exports profiles, active profile, MMR, and match history", async () => {
  const profiles = [profile("main", "Main", "main"), profile("alt", "Alt", "alt", "steam")];
  const updates = [
    { profileId: "main", mmr: 1000, updatedAt: "2026-01-01T10:00:00.000Z" },
    { profileId: "alt", mmr: 1200, updatedAt: "2026-01-02T10:00:00.000Z" },
  ];
  const records = [{ id: "match-1", profileId: "main", playedAt: "2026-01-01T11:00:00.000Z" }];
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({ version: 2, profiles, activeProfileId: "alt" }),
    "rl-companion.manual-mmr.v1": JSON.stringify({ version: 1, updates }),
    "rl-companion.auto-mmr.v1": JSON.stringify({
      version: 1,
      samples: [automaticSample("main"), automaticSample("alt", "c".repeat(64))],
    }),
    "rl-companion.match-records.v1": JSON.stringify({ version: 1, records }),
  });
  const app = createApp(storage);

  app.document.getElementById("export-backup").click();

  assert.ok(lastBlob);
  assert.match(
    app.document.body.children[0].download,
    /^RLCompanion_Backup_\d{4}-\d{2}-\d{2}\.json$/,
  );
  const result = JSON.parse(await lastBlob.text());
  assert.equal(result.format, "rl-companion-backup");
  assert.equal(result.version, 1);
  assert.equal(result.data.profileState.profiles.length, 2);
  assert.equal(result.data.profileState.activeProfileId, "alt");
  assert.equal(result.data.manualMmrHistory.updates.length, 2);
  assert.equal(result.data.automaticMmrHistory.samples.length, 2);
  assert.equal(result.data.matchHistory.records.length, 1);
});

test("imports into empty storage and retains profile-to-history links", async () => {
  const sourceProfiles = [
    profile("main", "Main", "main"),
    { ...profile("alt", "Alt", "alt", "steam"), gameAccountFingerprint: "a".repeat(64) },
  ];
  const sourceBackup = backup(
    sourceProfiles,
    [{ profileId: "alt", mmr: 1200, updatedAt: "2026-02-01T10:00:00.000Z" }],
    [{ id: "match-1", profileId: "alt", playedAt: "2026-02-01T11:00:00.000Z" }],
    profile("legacy", "Legacy", "legacy"),
    "alt",
    { version: 1, samples: [automaticSample("alt")] },
  );
  const storage = new MemoryStorage();
  const app = createApp(storage);

  await selectBackup(app, JSON.stringify(sourceBackup));
  assert.equal(app.document.getElementById("backup-import-preview").hidden, false);
  app.document.getElementById("confirm-backup-import").click();

  assert.equal(read(storage, "rl-companion.profiles.v2").profiles.length, 2);
  assert.equal(read(storage, "rl-companion.profiles.v2").activeProfileId, "alt");
  assert.equal(read(storage, "rl-companion.manual-mmr.v1").updates[0].profileId, "alt");
  assert.equal(read(storage, "rl-companion.auto-mmr.v1").samples[0].profileId, "alt");
  assert.equal(read(storage, "rl-companion.match-records.v1").records[0].profileId, "alt");
  assert.equal(read(storage, "rl-companion.profile.v1").id, "legacy");
  assert.equal(app.document.getElementById("profile-form").hidden, true);
  assert.equal(app.document.getElementById("profile-list").children.length, 2);
  assert.equal(typeof app.window.pendingTimer, "function");
});

test("saves confirmed MMR once and preserves manual entry and history", async () => {
  const fingerprint = "a".repeat(64);
  const manualUpdates = [
    { profileId: "main", mmr: 1300, updatedAt: "2026-01-01T10:00:00.000Z" },
  ];
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [{ ...profile("main", "Main", "main"), gameAccountFingerprint: fingerprint }],
      activeProfileId: "main",
    }),
    "rl-companion.manual-mmr.v1": JSON.stringify({ version: 1, updates: manualUpdates }),
  });
  const app = createApp(storage);
  const sample = {
    sampleId: "d".repeat(64),
    accountFingerprint: fingerprint,
    platform: "Epic",
    playlistId: 11,
    partySize: 1,
    rawPartyLeaderMmr: 65.4099,
    calculatedMmr: 1408.198,
    mmr: 1408.2,
    observedAt: "2026-02-01T10:00:00.000Z",
  };

  app.mmrBridge.handlers.onSample(sample);
  app.mmrBridge.handlers.onSample(sample);

  assert.deepEqual(read(storage, "rl-companion.manual-mmr.v1").updates, manualUpdates);
  const automatic = read(storage, "rl-companion.auto-mmr.v1").samples;
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0].profileId, "main");
  assert.equal(automatic[0].playlistId, 11);
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,408.2");
  assert.equal(app.document.getElementById("mmr-source-label").textContent, "AUTO · GAME LOG");
  assert.equal(app.document.getElementById("rank-progress-heading").textContent, "Champion III");
  assert.equal(app.document.getElementById("rank-progress-division").textContent, "DIVISION IV");
  assert.equal(app.document.getElementById("rank-progress-division-remaining").textContent, "26.8 MMR");

  app.document.getElementById("mmr-input").value = "1500";
  await app.document.getElementById("mmr-form").dispatch("submit");

  assert.equal(read(storage, "rl-companion.auto-mmr.v1").samples.length, 1);
  assert.equal(read(storage, "rl-companion.manual-mmr.v1").updates.length, 2);
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,500");
  assert.equal(app.document.getElementById("mmr-source-label").textContent, "MANUAL");
  assert.equal(app.document.getElementById("rank-progress-heading").textContent, "Grand Champion I");
  assert.equal(app.document.getElementById("rank-progress-division").textContent, "DIVISION III");
  assert.equal(app.document.getElementById("rank-progress-next-rank").textContent, "Grand Champion II");
  assert.equal(app.document.getElementById("rank-progress-rank-remaining").textContent, "75 MMR");
});

test("shows a helpful Rank Progress empty state without a saved MMR", () => {
  const app = createApp(new MemoryStorage());

  assert.equal(app.document.getElementById("rank-progress-content").hidden, true);
  assert.equal(app.document.getElementById("rank-progress-division").hidden, true);
  assert.equal(app.document.getElementById("rank-progress-empty").hidden, false);
  assert.match(
    app.document.getElementById("rank-progress-empty").textContent,
    /select a profile/i,
  );
});

test("rejects Casual MMR samples without changing ranked MMR or manual history", () => {
  const fingerprint = "a".repeat(64);
  const manualUpdates = [
    { profileId: "main", mmr: 1300, updatedAt: "2026-01-01T10:00:00.000Z" },
  ];
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [{ ...profile("main", "Main", "main"), gameAccountFingerprint: fingerprint }],
      activeProfileId: "main",
    }),
    "rl-companion.manual-mmr.v1": JSON.stringify({ version: 1, updates: manualUpdates }),
  });
  const app = createApp(storage);

  app.mmrBridge.handlers.onSample({
    sampleId: "d".repeat(64),
    accountFingerprint: fingerprint,
    platform: "Epic",
    playlistId: 2,
    partySize: 1,
    rawPartyLeaderMmr: 65.4099,
    calculatedMmr: 1408.198,
    mmr: 1408.2,
    observedAt: "2026-02-01T10:00:00.000Z",
  });

  assert.equal(read(storage, "rl-companion.auto-mmr.v1"), null);
  assert.deepEqual(read(storage, "rl-companion.manual-mmr.v1").updates, manualUpdates);
  assert.equal(app.document.getElementById("current-mmr").textContent, "1,300");
});

test("requires explicit account confirmation before binding an unlinked profile", () => {
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [profile("main", "Main", "main")],
      activeProfileId: "main",
    }),
  });
  const app = createApp(storage);
  const account = {
    fingerprint: "e".repeat(64),
    platform: "Epic",
    displayName: "Read Ahead",
  };

  app.mmrBridge.handlers.onAccount(account);
  assert.equal(app.document.getElementById("account-link-confirmation").hidden, false);
  assert.equal(read(storage, "rl-companion.profiles.v2").profiles[0].gameAccountFingerprint, undefined);

  app.document.getElementById("confirm-account-link").click();

  assert.equal(
    read(storage, "rl-companion.profiles.v2").profiles[0].gameAccountFingerprint,
    account.fingerprint,
  );
  assert.equal(app.document.getElementById("account-link-confirmation").hidden, true);
});

test("does not restore automatic samples onto a profile linked to another game account", async () => {
  const localProfile = {
    ...profile("main", "Main", "main"),
    gameAccountFingerprint: "a".repeat(64),
  };
  const importedProfile = {
    ...profile("backup-main", "Main", "main"),
    gameAccountFingerprint: "b".repeat(64),
  };
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [localProfile],
      activeProfileId: "main",
    }),
  });
  const app = createApp(storage);
  const sourceBackup = backup(
    [importedProfile],
    [],
    [],
    null,
    "backup-main",
    { version: 1, samples: [automaticSample("backup-main")] },
  );

  await selectBackup(app, JSON.stringify(sourceBackup));
  assert.match(app.document.getElementById("backup-preview-summary").textContent, /skipped to prevent account mismatch/);
  app.document.getElementById("confirm-backup-import").click();

  assert.equal(read(storage, "rl-companion.auto-mmr.v1").samples.length, 0);
  assert.equal(read(storage, "rl-companion.profiles.v2").profiles[0].gameAccountFingerprint, "a".repeat(64));
});

test("merges without replacing local profiles and remaps conflicting IDs", async () => {
  const localProfiles = [
    profile("local-main", "Local Main", "main"),
    profile("conflict", "Local Other", "local-other"),
  ];
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: localProfiles,
      activeProfileId: "local-main",
    }),
    "rl-companion.manual-mmr.v1": JSON.stringify({
      version: 1,
      updates: [{ profileId: "local-main", mmr: 1000, updatedAt: "2026-01-01T10:00:00.000Z" }],
    }),
    "rl-companion.match-records.v1": JSON.stringify({ version: 1, records: [] }),
  });
  const app = createApp(storage);
  const sourceBackup = backup(
    [
      profile("backup-main", "Backup Main", "main"),
      profile("conflict", "Imported Other", "imported-other"),
    ],
    [
      { profileId: "backup-main", mmr: 1000, updatedAt: "2026-01-01T10:00:00.000Z" },
      { profileId: "conflict", mmr: 1350, updatedAt: "2026-02-01T10:00:00.000Z" },
    ],
    [{ id: "match-imported", profileId: "conflict", playedAt: "2026-02-01T11:00:00.000Z" }],
  );

  await selectBackup(app, JSON.stringify(sourceBackup));
  assert.match(app.document.getElementById("backup-preview-summary").textContent, /reassigned/);
  app.document.getElementById("confirm-backup-import").click();

  const merged = read(storage, "rl-companion.profiles.v2");
  const importedProfile = merged.profiles.find((item) => item.username === "Imported Other");
  assert.equal(merged.profiles.length, 3);
  assert.equal(merged.activeProfileId, "local-main");
  assert.equal(merged.profiles[0].username, "Local Main");
  assert.ok(importedProfile && importedProfile.id !== "conflict");
  const updates = read(storage, "rl-companion.manual-mmr.v1").updates;
  assert.equal(updates.filter((item) => item.profileId === "local-main" && item.mmr === 1000).length, 1);
  assert.ok(updates.some((item) => item.profileId === importedProfile.id && item.mmr === 1350));
  assert.equal(read(storage, "rl-companion.match-records.v1").records[0].profileId, importedProfile.id);
});

test("rejects malformed, unsupported, and duplicate-ID backups without writes", async () => {
  const duplicate = profile("same-id", "One", "one");
  const duplicateIds = backup([
    duplicate,
    { ...duplicate, username: "Two", profileUrl: "https://rocketleague.tracker.network/rocket-league/profile/epic/two/overview" },
  ], []);
  const invalidBackups = [
    "{not json",
    JSON.stringify({ ...backup([], []), version: 9 }),
    JSON.stringify(duplicateIds),
  ];

  for (const contents of invalidBackups) {
    const storage = new MemoryStorage({
      "rl-companion.profiles.v2": JSON.stringify({
        version: 2,
        profiles: [profile("keep", "Keep", "keep")],
        activeProfileId: "keep",
      }),
      "rl-companion.manual-mmr.v1": JSON.stringify({ version: 1, updates: [] }),
      "rl-companion.match-records.v1": JSON.stringify({ version: 1, records: [] }),
    });
    const before = new Map(storage.values);
    const app = createApp(storage);

    await selectBackup(app, contents);

    assert.deepEqual([...storage.values], [...before]);
  }
});

test("rolls back earlier writes when a storage write fails", async () => {
  const storage = new MemoryStorage({
    "rl-companion.profiles.v2": JSON.stringify({
      version: 2,
      profiles: [profile("keep", "Keep", "keep")],
      activeProfileId: "keep",
    }),
    "rl-companion.manual-mmr.v1": JSON.stringify({ version: 1, updates: [] }),
    "rl-companion.match-records.v1": JSON.stringify({ version: 1, records: [] }),
  });
  const before = new Map(storage.values);
  storage.failKey = "rl-companion.match-records.v1";
  const app = createApp(storage);
  const sourceBackup = backup(
    [profile("new", "New", "new")],
    [{ profileId: "new", mmr: 500, updatedAt: "2026-03-01T10:00:00.000Z" }],
    [{ id: "new-match", profileId: "new", playedAt: "2026-03-01T11:00:00.000Z" }],
  );

  await selectBackup(app, JSON.stringify(sourceBackup));
  app.document.getElementById("confirm-backup-import").click();

  assert.deepEqual([...storage.values], [...before]);
  assert.match(app.document.getElementById("profile-manager-message").textContent, /restored/);
});
