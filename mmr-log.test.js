const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LaunchLogWatcher, MatchmakingLogParser } = require("./mmr-log");

const ACCOUNT_LINE = "[0010.00] Party: HandleLocalPlayerLoginStatusChanged PlayerName=Read Ahead PlayerID=Epic|private-test-account|0 LoginStatus=LS_LoggedIn IsPrimary=True IsInParty=False";

function matchmakingBlock({
  raw = "65.4099",
  playlists = "11",
  selectedCount = 1,
  partySize = 1,
  timestamp = "2026-11-16 08:02:07",
  elapsed = "0046.61",
  includeMmr = true,
  includeStart = true,
  includeSelection = true,
} = {}) {
  const lines = [
    `[${elapsed}] Matchmaking: OnlineGameMatchmaking_X::RecordStart`,
  ];
  if (includeMmr) {
    lines.push(`[${elapsed}] Matchmaking: Pre-divide PartyLeaderMMR: ${raw}`);
  }
  if (includeStart) {
    lines.push(`[${elapsed}] Matchmaking: StartMatchmaking at ${timestamp} in USE1,USE3 for playlists ${playlists} on game server `);
  }
  if (includeSelection) {
    lines.push(`[${elapsed}] Matchmaking: PreferredRegions.Length=(2) PreferredPlaylists.Length=(${selectedCount}) Party.GetOrderedPartyMemberIDs().Length=(${partySize})`);
  }
  return lines;
}

function feedBlock(options = {}) {
  const parser = new MatchmakingLogParser({ logSessionId: "test-session" });
  const events = parser.feedLine(ACCOUNT_LINE);
  matchmakingBlock(options).forEach((line) => events.push(...parser.feedLine(line)));
  return events;
}

test("parses the verified solo Ranked 2v2 example and preserves raw and calculated values", () => {
  const sample = feedBlock().find((event) => event.type === "sample");

  assert.ok(sample);
  assert.equal(sample.playlistId, 11);
  assert.equal(sample.rawPartyLeaderMmr, 65.4099);
  assert.equal(sample.calculatedMmr, 1408.198);
  assert.equal(sample.mmr, 1408.2);
  assert.equal(sample.partySize, 1);
  assert.equal(sample.observedAt, "2026-11-16T08:02:07.000Z");
  assert.match(sample.accountFingerprint, /^[a-f0-9]{64}$/);
  assert.match(sample.sampleId, /^[a-f0-9]{64}$/);
});

test("rejects other playlists, multiple queues, and party queues without verified local leadership", () => {
  for (const options of [
    { playlists: "10" },
    { playlists: "11,13" },
    { selectedCount: 2 },
    { partySize: 2 },
  ]) {
    const events = feedBlock(options);
    assert.equal(events.some((event) => event.type === "sample"), false);
    if (options.partySize === 2) {
      assert.match(events.find((event) => event.type === "rejected").reason, /party leader cannot be verified/);
    }
  }
});

test("rejects missing, malformed, out-of-range, and incomplete MMR blocks", () => {
  for (const options of [
    { includeMmr: false },
    { raw: "NaN" },
    { raw: "-1" },
    { raw: "600" },
    { includeSelection: false },
    { includeStart: false },
  ]) {
    assert.equal(feedBlock(options).some((event) => event.type === "sample"), false);
  }

  const postDivideOnly = new MatchmakingLogParser({ logSessionId: "test-session" });
  postDivideOnly.feedLine(ACCOUNT_LINE);
  [
    "[0046.61] Matchmaking: OnlineGameMatchmaking_X::RecordStart",
    "[0046.61] Matchmaking: Post-divide PartyLeaderMMR: 65.4099",
    "[0046.61] Matchmaking: StartMatchmaking at 2026-11-16 08:02:07 in USE1 for playlists 11 on game server ",
    "[0046.61] Matchmaking: PreferredRegions.Length=(1) PreferredPlaylists.Length=(1) Party.GetOrderedPartyMemberIDs().Length=(1)",
  ].forEach((line) => {
    assert.equal(postDivideOnly.feedLine(line).some((event) => event.type === "sample"), false);
  });
});

test("does not emit samples from an existing log when the helper starts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rl-companion-mmr-"));
  const logPath = path.join(directory, "Launch.log");
  const watcher = new LaunchLogWatcher({
    logPath,
    pollMs: 60_000,
    isGameRunning: async () => true,
  });
  let samples = 0;
  watcher.on("sample", () => samples++);

  try {
    await fs.writeFile(logPath, [ACCOUNT_LINE, ...matchmakingBlock()].join("\n") + "\n");
    await watcher.start();
    await watcher.poll();
    assert.equal(samples, 0);

    await fs.appendFile(logPath, matchmakingBlock({ elapsed: "0050.00" }).join("\n") + "\n");
    await watcher.poll();
    assert.equal(samples, 1);
    await watcher.poll();
    assert.equal(samples, 1);
  } finally {
    watcher.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("reads appended blocks and resumes correctly after log truncation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rl-companion-mmr-"));
  const logPath = path.join(directory, "Launch.log");
  const watcher = new LaunchLogWatcher({
    logPath,
    pollMs: 60_000,
    isGameRunning: async () => true,
  });
  const samples = [];
  watcher.on("sample", (sample) => samples.push(sample));

  try {
    await fs.writeFile(logPath, `${ACCOUNT_LINE}\n${"noise ".repeat(2000)}\n`);
    await watcher.start();
    await fs.appendFile(logPath, matchmakingBlock({ elapsed: "0050.00" }).join("\n") + "\n");
    await watcher.poll();
    assert.equal(samples.length, 1);

    await fs.writeFile(logPath, [ACCOUNT_LINE, ...matchmakingBlock({ elapsed: "0005.00" })].join("\n") + "\n");
    await watcher.poll();
    assert.equal(samples.length, 2);
    assert.notEqual(samples[0].sampleId, samples[1].sampleId);
  } finally {
    watcher.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps MMR detected status and warns when party-leader identity is unverified", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rl-companion-mmr-"));
  const logPath = path.join(directory, "Launch.log");
  const watcher = new LaunchLogWatcher({
    logPath,
    pollMs: 60_000,
    isGameRunning: async () => true,
  });

  try {
    await fs.writeFile(logPath, `${ACCOUNT_LINE}\n`);
    await watcher.start();
    await fs.appendFile(logPath, `${matchmakingBlock({ partySize: 2, elapsed: "0050.00" }).join("\n")}\n`);
    await watcher.poll();
    assert.equal(watcher.status.status, "party-leader-unverified");
    await watcher.poll();
    assert.equal(watcher.status.status, "party-leader-unverified");

    await fs.appendFile(logPath, `${matchmakingBlock({ elapsed: "0052.00" }).join("\n")}\n`);
    await watcher.poll();
    assert.equal(watcher.status.status, "mmr-detected");
    await watcher.poll();
    assert.equal(watcher.status.status, "mmr-detected");
  } finally {
    watcher.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("reports game shutdown and startup even while Launch.log remains on disk", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rl-companion-mmr-"));
  const logPath = path.join(directory, "Launch.log");
  let gameRunning = true;
  const watcher = new LaunchLogWatcher({
    logPath,
    pollMs: 60_000,
    gameCheckMs: 0,
    isGameRunning: async () => gameRunning,
  });

  try {
    await fs.writeFile(logPath, `${ACCOUNT_LINE}\n`);
    await watcher.start();
    assert.equal(watcher.status.status, "waiting-for-matchmaking");

    gameRunning = false;
    await watcher.poll();
    assert.equal(watcher.status.status, "waiting-for-game");

    gameRunning = true;
    await watcher.poll();
    assert.equal(watcher.status.status, "waiting-for-matchmaking");
  } finally {
    watcher.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
