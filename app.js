// Optional data for previewing the dashboard; never mixed with saved match history.
const demoMatches = [
  { playlistId: 11, result: "win", goalsFor: 3, goalsAgainst: 2, goals: 1, assists: 1, saves: 2, shots: 4, durationSeconds: 300, players: ["Paceɥ", "Teammate", "Opponent", "Opponent"], playedAt: new Date(Date.now() - 120000).toISOString() },
  { playlistId: 11, result: "win", goalsFor: 4, goalsAgainst: 1, goals: 2, assists: 0, saves: 1, shots: 5, durationSeconds: 298, players: ["Paceɥ", "Teammate", "Opponent", "Opponent"], playedAt: new Date(Date.now() - 480000).toISOString() },
  { playlistId: 11, result: "loss", goalsFor: 1, goalsAgainst: 3, goals: 0, assists: 1, saves: 3, shots: 2, durationSeconds: 302, players: ["Paceɥ", "Teammate", "Opponent", "Opponent"], playedAt: new Date(Date.now() - 900000).toISOString() },
];

let demoDataEnabled = false;
let selectedMode = "ranked";
let connectionState = "disconnected";
let manualMmrHistory = [];
let mmrStorageBlocked = false;
let automaticMmrHistory = [];
let automaticMmrStorageBlocked = false;
let mmrHelperStatus = {
  status: "helper-unavailable",
  message: "Local helper unavailable. Start the Node.js MMR helper.",
};
let detectedRocketLeagueAccount = null;
let dismissedAccountFingerprint = null;
let pendingAccountLink = null;
let pendingAutomaticMmrSample = null;

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "—";
  }
  const totalSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function appendCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
}

function renderMatchHistory(matches, isDemo, mode) {
  const matchList = document.getElementById("match-list");
  matchList.replaceChildren();
  document.getElementById("match-count").textContent =
    `${matches.length} MATCH${matches.length === 1 ? "" : "ES"}`;
  document.getElementById("match-history-note").textContent = isDemo
    ? "DEMO ONLY · These examples are not from Rocket League and are never saved."
    : "Match records are saved locally and contain only events received while connected.";

  if (matches.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-history";
    cell.colSpan = 10;
    const modeName = mode === "casual" ? "Casual" : "Ranked";
    cell.textContent = isDemo
      ? `No ${modeName} demo matches are available.`
      : `No ${modeName} matches recorded yet.`;
    row.append(cell);
    matchList.append(row);
    return;
  }

  matches.forEach((match) => {
    const row = document.createElement("tr");
    const resultName = match.result === "win"
      ? "Win"
      : match.result === "loss" ? "Loss" : "Unknown";
    const resultCell = document.createElement("td");
    const result = document.createElement("span");
    result.className = "result";
    const badge = document.createElement("span");
    badge.className = `result-badge ${match.result === "win" ? "win" : match.result === "loss" ? "loss" : "unknown"}`;
    badge.textContent = match.result === "win" ? "W" : match.result === "loss" ? "L" : "—";
    const label = document.createElement("span");
    label.className = "result-text";
    label.textContent = resultName;
    result.append(badge, label);
    resultCell.append(result);
    row.append(resultCell);
    appendCell(row, window.RLMatchTracker.getPlaylistName(match.playlistId));

    const score = match.goalsFor === null || match.goalsAgainst === null
      || match.goalsFor === undefined || match.goalsAgainst === undefined
      ? "—"
      : `${match.goalsFor} – ${match.goalsAgainst}`;
    appendCell(row, score);
    appendCell(row, String(match.goals ?? "—"));
    appendCell(row, String(match.assists ?? "—"));
    appendCell(row, String(match.saves ?? "—"));
    appendCell(row, String(match.shots ?? "—"));
    appendCell(row, formatDuration(match.durationSeconds));
    appendCell(row, Array.isArray(match.players) ? match.players.join(", ") : "—", "players-cell");
    const playedAt = new Date(match.playedAt);
    appendCell(
      row,
      Number.isNaN(playedAt.getTime()) ? "—" : playedAt.toLocaleString(),
      "time-cell",
    );
    if (isDemo) {
      row.classList.add("demo-row");
    }
    matchList.append(row);
  });
}

function renderSessionStats(matches, isDemo, mode) {
  const modeName = mode === "casual" ? "Casual" : "Ranked";
  const knownResults = matches.filter(
    (match) => match.result === "win" || match.result === "loss",
  );
  const wins = knownResults.filter((match) => match.result === "win").length;
  const losses = knownResults.length - wins;
  const winRate = knownResults.length
    ? Math.round((wins / knownResults.length) * 100)
    : null;

  document.getElementById("session-wins").textContent =
    knownResults.length ? String(wins) : "—";
  document.getElementById("session-losses").textContent =
    knownResults.length ? String(losses) : "—";
  document.getElementById("recorded-match-count").textContent = String(matches.length);

  let streakResult = null;
  let streakCount = 0;
  for (const match of matches) {
    if (match.result !== "win" && match.result !== "loss") {
      break;
    }
    if (!streakResult) {
      streakResult = match.result;
    }
    if (match.result !== streakResult) {
      break;
    }
    streakCount += 1;
  }

  const streakText = streakCount
    ? `${streakCount} ${streakResult}${streakCount === 1 ? "" : "s"} in a row`
    : "no active streak";
  document.getElementById("session-summary").textContent = knownResults.length
    ? `${winRate}% win rate · ${streakText}`
    : `No completed ${modeName.toLowerCase()} matches recorded`;

  const markers = document.getElementById("streak-markers");
  markers.replaceChildren();
  for (let index = 0; index < Math.min(streakCount, 5); index += 1) {
    const marker = document.createElement("span");
    marker.className = `streak-marker active${streakResult === "loss" ? " loss" : ""}`;
    marker.textContent = streakResult === "win" ? "W" : "L";
    markers.append(marker);
  }
  markers.setAttribute(
    "aria-label",
    streakCount ? `${streakCount} consecutive ${streakResult}s` : "No match streak recorded",
  );

  const badge = document.getElementById("session-data-badge");
  const badgeText = isDemo
    ? "DEMO"
    : connectionState === "connected" ? "LIVE" : matches.length ? "RECORDED" : "WAITING";
  document.getElementById("session-data-badge-label").textContent = badgeText;
  document.getElementById("global-data-badge").lastChild.textContent =
    isDemo
      ? " DEMO DATA"
      : connectionState === "connected"
        ? " LIVE API"
        : matches.length ? " SAVED MATCHES" : " NO LIVE DATA";

  const activeProfile = getActiveProfile();
  const displayName = activeProfile
    ? activeProfile.nickname || activeProfile.username
    : "the selected profile";
  document.getElementById("profile-sample-note").textContent = isDemo
    ? "DEMO DATA ONLY · These sample statistics are not connected to Rocket League."
    : matches.length
      ? `Actual ${modeName.toLowerCase()} Stats API records for ${displayName}.`
      : connectionState === "connected"
        ? `Connected · waiting for a completed ${modeName.toLowerCase()} match with the active profile in its player list.`
        : `No ${modeName.toLowerCase()} match data yet · connect to Rocket League to begin recording.`;
}

function renderDashboard(matches, isDemo = false, mode = selectedMode) {
  renderSessionStats(matches, isDemo, mode);
  renderMatchHistory(matches, isDemo, mode);
}

function getActiveProfile() {
  return profileState.profiles.find(
    (profile) => profile.id === profileState.activeProfileId,
  ) || null;
}

function refreshPlayerDashboard() {
  if (demoDataEnabled) {
    const matches = demoMatches.filter(
      (match) => window.RLMatchTracker.getPlaylistMode(match.playlistId) === selectedMode,
    );
    renderDashboard(matches, true, selectedMode);
    return;
  }
  const activeProfile = getActiveProfile();
  const matches = activeProfile && window.RLMatchTracker
    ? window.RLMatchTracker.getMatches(activeProfile.id, selectedMode)
    : [];
  renderDashboard(matches, false, selectedMode);
}

function setSelectedMode(mode) {
  if (!["ranked", "casual"].includes(mode)) {
    return;
  }
  if (mode === selectedMode) {
    return;
  }
  selectedMode = mode;
  updateModeSelector();
  refreshPlayerDashboard();
}

function updateModeSelector() {
  const isRanked = selectedMode === "ranked";
  const modeName = isRanked ? "Ranked" : "Casual";
  const rankedButton = document.getElementById("ranked-mode-button");
  const casualButton = document.getElementById("casual-mode-button");
  rankedButton.classList.toggle("is-selected", isRanked);
  rankedButton.setAttribute("aria-pressed", String(isRanked));
  casualButton.classList.toggle("is-selected", !isRanked);
  casualButton.setAttribute("aria-pressed", String(!isRanked));
  document.getElementById("page-title").textContent = `${modeName} Overview`;
  document.getElementById("session-heading").textContent = `${modeName} statistics`;
  document.getElementById("rank-card").hidden = !isRanked;
  document.getElementById("overview-grid").classList.toggle("is-casual", !isRanked);
  document.getElementById("overview-grid").setAttribute(
    "aria-label",
    isRanked ? "Ranked MMR and session overview" : "Casual session overview",
  );
}

function initializeModeSelector() {
  document.getElementById("ranked-mode-button").addEventListener("click", () => {
    setSelectedMode("ranked");
  });
  document.getElementById("casual-mode-button").addEventListener("click", () => {
    setSelectedMode("casual");
  });
  updateModeSelector();
}

function renderSessionDate() {
  // Show today's date while keeping all match and account data simulated.
  document.getElementById("session-date").textContent =
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date());
}

const PROFILE_STORAGE_KEY = "rl-companion.profiles.v2";
const LEGACY_PROFILE_STORAGE_KEY = "rl-companion.profile.v1";
const MANUAL_MMR_STORAGE_KEY = "rl-companion.manual-mmr.v1";
const AUTOMATIC_MMR_STORAGE_KEY = "rl-companion.auto-mmr.v1";
const MATCH_STORAGE_KEY = "rl-companion.match-records.v1";
const BACKUP_FORMAT = "rl-companion-backup";
const BACKUP_VERSION = 1;
const PLATFORM_NAMES = {
  epic: "Epic Games",
  steam: "Steam",
  playstation: "PlayStation",
  xbox: "Xbox",
};

let profileState = { profiles: [], activeProfileId: null };
let profilePendingConfirmation = null;
let profileBeingEditedId = null;
let profilePendingDeletionId = null;
let pendingBackupImport = null;
let profileStorageBlocked = false;

function showProfileMessage(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.hidden = false;
}

function clearProfileMessage(element) {
  element.textContent = "";
  element.classList.remove("is-error");
  element.hidden = true;
}

function setProfileStatus(message, isSaved) {
  const status = document.getElementById("profile-status");
  status.textContent = message;
  status.classList.toggle("is-saved", isSaved);
}

function isValidSavedProfile(profile) {
  return profile
    && typeof profile === "object"
    && typeof profile.id === "string"
    && profile.id.length > 0
    && Object.prototype.hasOwnProperty.call(PLATFORM_NAMES, profile.platform)
    && typeof profile.username === "string"
    && profile.username.trim().length > 0
    && (profile.nickname === undefined || typeof profile.nickname === "string")
    && (
      profile.gameAccountFingerprint === undefined
      || (typeof profile.gameAccountFingerprint === "string"
        && /^[a-f0-9]{64}$/.test(profile.gameAccountFingerprint))
    )
    && typeof profile.profileUrl === "string"
    && !validateTrackerProfileUrl(profile.profileUrl, profile.platform).error;
}

function createProfileId() {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidProfileState(value) {
  return value
    && typeof value === "object"
    && value.version === 2
    && Array.isArray(value.profiles)
    && value.profiles.every(isValidSavedProfile)
    && hasUniqueGameAccountFingerprints(value.profiles)
    && (
      value.activeProfileId === null
      || (typeof value.activeProfileId === "string"
        && value.profiles.some((profile) => profile.id === value.activeProfileId))
    );
}

function hasUniqueGameAccountFingerprints(profiles) {
  const fingerprints = new Set();
  for (const profile of profiles) {
    if (!profile.gameAccountFingerprint) {
      continue;
    }
    if (fingerprints.has(profile.gameAccountFingerprint)) {
      return false;
    }
    fingerprints.add(profile.gameAccountFingerprint);
  }
  return true;
}

function hasUniqueProfileIds(profiles) {
  const ids = new Set();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      return false;
    }
    ids.add(profile.id);
  }
  return true;
}

function isValidManualMmrHistory(value) {
  return value
    && value.version === 1
    && Array.isArray(value.updates)
    && value.updates.every((update) =>
      update
      && typeof update.profileId === "string"
      && Number.isInteger(update.mmr)
      && update.mmr >= 0
      && typeof update.updatedAt === "string");
}

function isValidAutomaticMmrHistory(value) {
  return value
    && value.version === 1
    && Array.isArray(value.samples)
    && value.samples.every((sample) =>
      sample
      && typeof sample.profileId === "string"
      && typeof sample.sampleId === "string"
      && /^[a-f0-9]{64}$/.test(sample.sampleId)
      && sample.playlistId === 11
      && Number.isFinite(sample.rawPartyLeaderMmr)
      && sample.rawPartyLeaderMmr > 0
      && sample.rawPartyLeaderMmr <= 494.95
      && Number.isFinite(sample.calculatedMmr)
      && sample.calculatedMmr === Number(((sample.rawPartyLeaderMmr * 20) + 100).toFixed(3))
      && sample.calculatedMmr <= 9999
      && Number.isFinite(sample.mmr)
      && sample.mmr === Math.round(sample.calculatedMmr * 10) / 10
      && typeof sample.updatedAt === "string"
      && !Number.isNaN(Date.parse(sample.updatedAt))
      && sample.source === "launch-log");
}

function isValidMatchHistory(value) {
  return value
    && value.version === 1
    && Array.isArray(value.records)
    && value.records.every((record) =>
      record
      && typeof record.id === "string"
      && typeof record.profileId === "string"
      && typeof record.playedAt === "string");
}

function isValidLegacyProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return false;
  }
  const candidate = {
    ...profile,
    id: typeof profile.id === "string" && profile.id.length > 0
      ? profile.id
      : "legacy-profile",
  };
  return isValidSavedProfile(candidate);
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("The selected file is not an RL COMPANION backup.");
  }
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new Error("This backup format or version is not supported.");
  }
  if (typeof backup.createdAt !== "string" || Number.isNaN(Date.parse(backup.createdAt))) {
    throw new Error("The backup creation date is missing or invalid.");
  }

  const data = backup.data;
  if (
    data
    && isValidProfileState(data.profileState)
    && !hasUniqueProfileIds(data.profileState.profiles)
  ) {
    throw new Error("The backup contains duplicate profile IDs; no data was changed.");
  }
  if (
    !data
    || !isValidProfileState(data.profileState)
    || !isValidManualMmrHistory(data.manualMmrHistory)
    || (
      data.automaticMmrHistory !== undefined
      && !isValidAutomaticMmrHistory(data.automaticMmrHistory)
    )
    || !isValidMatchHistory(data.matchHistory)
    || !data.settings
    || typeof data.settings !== "object"
    || Array.isArray(data.settings)
    || (data.legacyProfile !== null && !isValidLegacyProfile(data.legacyProfile))
  ) {
    throw new Error("The backup contents are incomplete or invalid; no data was changed.");
  }
  return backup;
}

function getProfileIdentity(profile) {
  return `${profile.platform}|${new URL(profile.profileUrl).href}`;
}

function createUnusedProfileId(usedIds) {
  const baseId = createProfileId();
  let candidate = baseId;
  let suffix = 1;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function readCurrentBackupData() {
  if (profileStorageBlocked || mmrStorageBlocked || automaticMmrStorageBlocked) {
    throw new Error("Existing profile or MMR data could not be safely loaded; import was stopped.");
  }

  let profileStateValue = { version: 2, profiles: [], activeProfileId: null };
  let manualMmrHistoryValue = { version: 1, updates: [] };
  let automaticMmrHistoryValue = { version: 1, samples: [] };
  let matchHistoryValue = { version: 1, records: [] };
  let legacyProfileValue = null;

  try {
    const storedProfiles = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (storedProfiles) {
      profileStateValue = JSON.parse(storedProfiles);
    }
    const storedMmr = localStorage.getItem(MANUAL_MMR_STORAGE_KEY);
    if (storedMmr) {
      manualMmrHistoryValue = JSON.parse(storedMmr);
    }
    const storedAutomaticMmr = localStorage.getItem(AUTOMATIC_MMR_STORAGE_KEY);
    if (storedAutomaticMmr) {
      automaticMmrHistoryValue = JSON.parse(storedAutomaticMmr);
    }
    const storedMatches = localStorage.getItem(MATCH_STORAGE_KEY);
    if (storedMatches) {
      matchHistoryValue = JSON.parse(storedMatches);
    }
    const storedLegacyProfile = localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
    if (storedLegacyProfile !== null) {
      legacyProfileValue = JSON.parse(storedLegacyProfile);
    }
  } catch {
    throw new Error("Stored data could not be read safely; no data was changed.");
  }

  if (
    !isValidProfileState(profileStateValue)
    || !hasUniqueProfileIds(profileStateValue.profiles)
    || !isValidManualMmrHistory(manualMmrHistoryValue)
    || !isValidAutomaticMmrHistory(automaticMmrHistoryValue)
    || !isValidMatchHistory(matchHistoryValue)
    || (legacyProfileValue !== null && !isValidLegacyProfile(legacyProfileValue))
  ) {
    throw new Error("Stored data could not be validated safely; no data was changed.");
  }
  return {
    profileState: profileStateValue,
    manualMmrHistory: manualMmrHistoryValue,
    automaticMmrHistory: automaticMmrHistoryValue,
    matchHistory: matchHistoryValue,
    legacyProfile: legacyProfileValue,
  };
}

function mergeBackupData(backup, current) {
  const profiles = current.profileState.profiles.map((profile) => ({ ...profile }));
  const usedIds = new Set(profiles.map((profile) => profile.id));
  const identityProfiles = new Map();
  profiles.forEach((profile) => {
    const identity = getProfileIdentity(profile);
    if (!identityProfiles.has(identity)) {
      identityProfiles.set(identity, profile);
    }
  });

  const backupProfiles = backup.data.profileState.profiles;
  const backupProfileIds = new Set(backupProfiles.map((profile) => profile.id));
  const profileIdMap = new Map();
  let profilesAdded = 0;
  let duplicateProfiles = 0;
  let conflictingIds = 0;

  backupProfiles.forEach((profile) => {
    const existing = identityProfiles.get(getProfileIdentity(profile));
    if (existing) {
      profileIdMap.set(profile.id, existing.id);
      if (
        !existing.gameAccountFingerprint
        && profile.gameAccountFingerprint
        && !profiles.some((item) =>
          item.id !== existing.id
          && item.gameAccountFingerprint === profile.gameAccountFingerprint)
      ) {
        existing.gameAccountFingerprint = profile.gameAccountFingerprint;
      }
      duplicateProfiles += 1;
      return;
    }

    let restoredId = profile.id;
    if (usedIds.has(restoredId)) {
      restoredId = createUnusedProfileId(usedIds);
      conflictingIds += 1;
    }
    const restoredProfile = { ...profile, id: restoredId };
    if (
      restoredProfile.gameAccountFingerprint
      && profiles.some((item) =>
        item.gameAccountFingerprint === restoredProfile.gameAccountFingerprint)
    ) {
      delete restoredProfile.gameAccountFingerprint;
    }
    profiles.push(restoredProfile);
    usedIds.add(restoredId);
    identityProfiles.set(getProfileIdentity(restoredProfile), restoredProfile);
    profileIdMap.set(profile.id, restoredId);
    profilesAdded += 1;
  });

  const orphanIdMap = new Map();
  function remapProfileId(profileId) {
    if (profileIdMap.has(profileId)) {
      return profileIdMap.get(profileId);
    }
    if (!backupProfileIds.has(profileId) && usedIds.has(profileId)) {
      if (!orphanIdMap.has(profileId)) {
        orphanIdMap.set(profileId, createUnusedProfileId(usedIds));
        usedIds.add(orphanIdMap.get(profileId));
      }
      return orphanIdMap.get(profileId);
    }
    return profileId;
  }

  const updates = current.manualMmrHistory.updates.slice();
  const updateKeys = new Set(updates.map((update) =>
    JSON.stringify([update.profileId, update.mmr, update.updatedAt])));
  let mmrUpdatesAdded = 0;
  backup.data.manualMmrHistory.updates.forEach((update) => {
    const restoredUpdate = { ...update, profileId: remapProfileId(update.profileId) };
    const key = JSON.stringify([
      restoredUpdate.profileId,
      restoredUpdate.mmr,
      restoredUpdate.updatedAt,
    ]);
    if (!updateKeys.has(key)) {
      updates.push(restoredUpdate);
      updateKeys.add(key);
      mmrUpdatesAdded += 1;
    }
  });
  updates.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const automaticSamples = current.automaticMmrHistory.samples.slice();
  const automaticSampleKeys = new Set(automaticSamples.map((sample) =>
    JSON.stringify([sample.profileId, sample.sampleId])));
  let automaticMmrSamplesAdded = 0;
  let automaticMmrSamplesSkipped = 0;
  const importedAutomaticSamples = backup.data.automaticMmrHistory
    ? backup.data.automaticMmrHistory.samples
    : [];
  importedAutomaticSamples.forEach((sample) => {
    const sourceProfile = backupProfiles.find((profile) => profile.id === sample.profileId);
    const restoredProfileId = remapProfileId(sample.profileId);
    const restoredProfile = profiles.find((profile) => profile.id === restoredProfileId);
    if (
      !sourceProfile
      || !sourceProfile.gameAccountFingerprint
      || !restoredProfile
      || sourceProfile.gameAccountFingerprint !== restoredProfile.gameAccountFingerprint
    ) {
      automaticMmrSamplesSkipped += 1;
      return;
    }

    const restoredSample = { ...sample, profileId: restoredProfileId };
    const key = JSON.stringify([restoredSample.profileId, restoredSample.sampleId]);
    if (!automaticSampleKeys.has(key)) {
      automaticSamples.push(restoredSample);
      automaticSampleKeys.add(key);
      automaticMmrSamplesAdded += 1;
    }
  });
  automaticSamples.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const records = current.matchHistory.records.slice();
  let matchRecordsAdded = 0;
  backup.data.matchHistory.records.forEach((record) => {
    const restoredRecord = { ...record, profileId: remapProfileId(record.profileId) };
    const duplicate = records.some((existing) =>
      existing.profileId === restoredRecord.profileId
      && (existing.id === restoredRecord.id
        || (restoredRecord.matchGuid && existing.matchGuid === restoredRecord.matchGuid)));
    if (!duplicate) {
      records.push(restoredRecord);
      matchRecordsAdded += 1;
    }
  });

  const importedActiveId = backup.data.profileState.activeProfileId;
  const activeProfileId = current.profileState.activeProfileId
    || (importedActiveId && profileIdMap.get(importedActiveId))
    || null;
  const profileState = { version: 2, profiles, activeProfileId };
  const legacyProfile = current.legacyProfile || backup.data.legacyProfile;
  const legacyProfileAdded = !current.legacyProfile && Boolean(backup.data.legacyProfile);

  return {
    profileState,
    manualMmrHistory: { version: 1, updates },
    automaticMmrHistory: { version: 1, samples: automaticSamples },
    matchHistory: { version: 1, records },
    legacyProfile,
    profilesAdded,
    duplicateProfiles,
    conflictingIds,
    mmrUpdatesAdded,
    automaticMmrSamplesAdded,
    automaticMmrSamplesSkipped,
    matchRecordsAdded,
    legacyProfileAdded,
    activeProfileChanged: !current.profileState.activeProfileId && Boolean(activeProfileId),
  };
}

function createBackupDocument() {
  const current = readCurrentBackupData();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      profileState: current.profileState,
      manualMmrHistory: current.manualMmrHistory,
      automaticMmrHistory: current.automaticMmrHistory,
      matchHistory: current.matchHistory,
      legacyProfile: current.legacyProfile,
      settings: {},
    },
  };
}

function exportBackup() {
  try {
    const backup = createBackupDocument();
    const contents = JSON.stringify(backup, null, 2);
    const blob = new Blob([contents], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `RLCompanion_Backup_${backup.createdAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      "Backup exported. Keep the downloaded JSON file somewhere safe.",
      false,
    );
  } catch (error) {
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      error instanceof Error
        ? `Backup export failed: ${error.message}`
        : "Backup export failed. Existing data was not changed.",
      true,
    );
  }
}

function createBackupImportPlan(backup) {
  const current = readCurrentBackupData();
  return mergeBackupData(backup, current);
}

function commitBackupImport(plan) {
  let previousValues;
  try {
    previousValues = new Map([
      [PROFILE_STORAGE_KEY, localStorage.getItem(PROFILE_STORAGE_KEY)],
      [MANUAL_MMR_STORAGE_KEY, localStorage.getItem(MANUAL_MMR_STORAGE_KEY)],
      [AUTOMATIC_MMR_STORAGE_KEY, localStorage.getItem(AUTOMATIC_MMR_STORAGE_KEY)],
      [MATCH_STORAGE_KEY, localStorage.getItem(MATCH_STORAGE_KEY)],
      [LEGACY_PROFILE_STORAGE_KEY, localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY)],
    ]);
  } catch {
    return { error: "Local storage could not be read; nothing was imported." };
  }

  const writes = [
    [
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profiles: plan.profileState.profiles,
        activeProfileId: plan.profileState.activeProfileId,
      }),
    ],
    [MANUAL_MMR_STORAGE_KEY, JSON.stringify(plan.manualMmrHistory)],
    [AUTOMATIC_MMR_STORAGE_KEY, JSON.stringify(plan.automaticMmrHistory)],
    [MATCH_STORAGE_KEY, JSON.stringify(plan.matchHistory)],
  ];
  if (previousValues.get(LEGACY_PROFILE_STORAGE_KEY) === null && plan.legacyProfile) {
    writes.push([LEGACY_PROFILE_STORAGE_KEY, JSON.stringify(plan.legacyProfile)]);
  }

  const writtenKeys = [];
  try {
    writes.forEach(([key, value]) => {
      if (previousValues.get(key) === value) {
        return;
      }
      localStorage.setItem(key, value);
      writtenKeys.push(key);
    });
  } catch {
    let rollbackFailed = false;
    writtenKeys.reverse().forEach((key) => {
      try {
        const previousValue = previousValues.get(key);
        if (previousValue === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, previousValue);
        }
      } catch {
        rollbackFailed = true;
      }
    });
    return {
      error: rollbackFailed
        ? "Import failed and storage rollback was incomplete. Stop editing data and check browser storage before continuing."
        : "Import failed while saving. Previous data was restored and left unchanged.",
    };
  }
  return { success: true };
}

function loadProfileState() {
  let savedValue;
  try {
    savedValue = localStorage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    return {
      error: "Local profile storage is unavailable in this browser. Check your browser settings and try again.",
      blocked: true,
    };
  }

  if (savedValue) {
    try {
      const state = JSON.parse(savedValue);
      if (!isValidProfileState(state)) {
        return {
          error: "Saved profiles could not be validated. They were left untouched; check this browser's local storage before editing profiles.",
          blocked: true,
        };
      }
      return { state };
    } catch {
      return {
        error: "Saved profile data could not be read. It was left untouched; check this browser's local storage before editing profiles.",
        blocked: true,
      };
    }
  }

  // Migrate the original single-profile setting once, retaining its platform, username and URL.
  let legacyValue;
  try {
    legacyValue = localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
  } catch {
    return {
      error: "Local profile storage is unavailable in this browser. Check your browser settings and try again.",
      blocked: true,
    };
  }

  if (!legacyValue) {
    return { state: { profiles: [], activeProfileId: null } };
  }

  try {
    const oldProfile = JSON.parse(legacyValue);
    if (!oldProfile || typeof oldProfile !== "object") {
      throw new Error("Invalid legacy profile");
    }

    const migratedProfile = {
      ...oldProfile,
      id: typeof oldProfile.id === "string" && oldProfile.id.length > 0
        ? oldProfile.id
        : createProfileId(),
      nickname: typeof oldProfile.nickname === "string" ? oldProfile.nickname : "",
      role: typeof oldProfile.role === "string" ? oldProfile.role : "player",
    };
    if (!isValidSavedProfile(migratedProfile)) {
      return {
        error: "The previously saved profile could not be validated and was left untouched.",
        blocked: true,
      };
    }
    const state = {
      profiles: [migratedProfile],
      activeProfileId: migratedProfile.id,
    };
    if (!persistProfileState(state)) {
      return {
        error: "The previous profile was read but could not be migrated to local storage. Check browser storage settings and reload.",
        blocked: true,
      };
    }
    return { state };
  } catch {
    return {
      error: "The previous profile data could not be read and was left untouched.",
      blocked: true,
    };
  }
}

function persistProfileState(state) {
  try {
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function validateTrackerProfileUrl(value, selectedPlatform) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return {
      error: "Enter a complete Rocket League Tracker profile URL, including https://.",
    };
  }

  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "rocketleague.tracker.network"
    || url.port
    || url.username
    || url.password
  ) {
    return {
      error: "Use a profile link on rocketleague.tracker.network. This app does not open other URLs as profile links.",
    };
  }

  const profilePath = url.pathname.match(
    /^\/rocket-league\/profile\/([^/]+)\/([^/]+)(?:\/|$)/i,
  );
  if (!profilePath) {
    return {
      error: "That URL doesn't look like a Rocket League Tracker profile page. Copy the full profile URL from Tracker.",
    };
  }

  const platformSlug = profilePath[1].toLowerCase();
  const acceptedSlugs = {
    epic: ["epic"],
    steam: ["steam"],
    playstation: ["psn", "playstation"],
    xbox: ["xbox", "xboxone"],
  };
  if (!acceptedSlugs[selectedPlatform].includes(platformSlug)) {
    return {
      error: `The Tracker URL platform (${platformSlug}) doesn't match the selected ${PLATFORM_NAMES[selectedPlatform]} platform.`,
    };
  }

  return { url: url.href };
}

function setFormProfile(profile) {
  document.getElementById("profile-platform").value = profile.platform;
  document.getElementById("profile-username").value = profile.username;
  document.getElementById("profile-nickname").value = profile.nickname || "";
  document.getElementById("profile-url").value = profile.profileUrl;
}

function showProfileForm(profile = null) {
  profileBeingEditedId = profile ? profile.id : null;
  document.getElementById("profile-form").hidden = false;
  document.getElementById("profile-confirmation").hidden = true;
  document.getElementById("profile-form-heading").textContent =
    profile ? "Edit profile" : "Add a profile";
  document.getElementById("cancel-profile-edit").hidden = false;
  if (profile) {
    setFormProfile(profile);
  } else {
    document.getElementById("profile-form").reset();
    document.getElementById("profile-username").value = "";
    document.getElementById("profile-platform").value = "epic";
  }
  document.getElementById("profile-reviewed").checked = false;
  document.getElementById("save-profile").disabled = true;
  clearProfileMessage(document.getElementById("profile-message"));
}

function closeProfileForm() {
  profilePendingConfirmation = null;
  profileBeingEditedId = null;
  document.getElementById("profile-form").reset();
  document.getElementById("profile-form").hidden = true;
  document.getElementById("profile-form-heading").textContent = "Add a profile";
  document.getElementById("profile-platform").value = "epic";
  document.getElementById("profile-username").value = "";
  document.getElementById("profile-nickname").value = "";
  document.getElementById("profile-url").value = "";
  document.getElementById("profile-confirmation").hidden = true;
  document.getElementById("cancel-profile-edit").hidden = true;
  document.getElementById("profile-reviewed").checked = false;
  document.getElementById("save-profile").disabled = true;
  clearProfileMessage(document.getElementById("profile-message"));
}

function showProfileConfirmation(profile) {
  profilePendingConfirmation = profile;
  document.getElementById("profile-form").hidden = true;
  document.getElementById("cancel-profile-edit").hidden = true;
  document.getElementById("profile-confirmation").hidden = false;
  document.getElementById("confirmation-platform").textContent =
    PLATFORM_NAMES[profile.platform];
  document.getElementById("confirmation-username").textContent =
    profile.username;
  document.getElementById("confirmation-nickname").textContent =
    profile.nickname || "—";

  const profileLink = document.getElementById("confirmation-url");
  profileLink.href = profile.profileUrl;
  profileLink.textContent = profile.profileUrl;
  document.getElementById("profile-reviewed").checked = false;
  document.getElementById("save-profile").disabled = true;
  clearProfileMessage(document.getElementById("confirmation-message"));
  setProfileStatus("REVIEW REQUIRED", false);
}

function renderActiveProfileContext() {
  const activeProfile = getActiveProfile();
  const context = document.getElementById("dashboard-profile-context");

  if (!activeProfile) {
    context.textContent = "No active profile selected";
  } else {
    const displayName = activeProfile.nickname || activeProfile.username;
    context.textContent = `Active profile: ${displayName} · ${PLATFORM_NAMES[activeProfile.platform]}`;
  }

  renderManualMmr();
  if (detectedRocketLeagueAccount) {
    handleRocketLeagueAccount(detectedRocketLeagueAccount);
  }
  refreshPlayerDashboard();
  updateLiveMatchDisplay();
}

function createProfileButton(label, className, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function renderProfileList() {
  const list = document.getElementById("profile-list");
  const emptyMessage = document.getElementById("profile-empty");
  const deleteConfirmation = document.getElementById("delete-confirmation");
  clearProfileMessage(document.getElementById("profile-manager-message"));
  list.replaceChildren();
  emptyMessage.hidden = profileState.profiles.length > 0;

  profileState.profiles.forEach((profile) => {
    const isActive = profile.id === profileState.activeProfileId;
    const item = document.createElement("li");
    item.className = `profile-list-item${isActive ? " is-active" : ""}`;

    const details = document.createElement("div");
    details.className = "profile-list-details";
    const title = document.createElement("div");
    title.className = "profile-list-title";
    const primaryName = document.createElement("span");
    primaryName.textContent = profile.nickname || profile.username;
    title.append(primaryName);

    if (isActive) {
      const activeTag = document.createElement("span");
      activeTag.className = "active-profile-tag";
      activeTag.textContent = "ACTIVE";
      title.append(activeTag);
    }

    const platform = document.createElement("span");
    platform.className = "profile-list-platform";
    platform.textContent = PLATFORM_NAMES[profile.platform];
    const username = document.createElement("span");
    username.className = "profile-list-subtitle";
    username.textContent = profile.nickname
      ? profile.username
      : "Tracker profile saved locally · not verified";

    details.append(title, platform, username);
    const actions = document.createElement("div");
    actions.className = "profile-list-actions";
    actions.append(
      createProfileButton(
        isActive ? "Active" : "Set active",
        "button-secondary",
        () => setActiveProfile(profile.id),
        isActive,
      ),
      createProfileButton(
        "Edit",
        "button-secondary",
        () => showProfileForm(profile),
      ),
      createProfileButton(
        "Remove",
        "button-danger",
        () => requestProfileDeletion(profile.id),
      ),
    );
    item.append(details, actions);
    list.append(item);
  });

  if (
    profilePendingDeletionId
    && profileState.profiles.some((profile) => profile.id === profilePendingDeletionId)
  ) {
    const profile = profileState.profiles.find(
      (item) => item.id === profilePendingDeletionId,
    );
    document.getElementById("delete-confirmation-text").textContent =
      `Remove ${profile.nickname || profile.username} from this device?`;
    deleteConfirmation.hidden = false;
  } else {
    deleteConfirmation.hidden = true;
    profilePendingDeletionId = null;
  }

  const activeProfile = profileState.profiles.find(
    (profile) => profile.id === profileState.activeProfileId,
  );
  setProfileStatus(
    activeProfile ? `${profileState.profiles.length} PROFILE${profileState.profiles.length === 1 ? "" : "S"}` : "NO ACTIVE PROFILE",
    Boolean(activeProfile),
  );
  renderActiveProfileContext();
}

function saveProfileState(nextState, errorElement) {
  if (profileStorageBlocked) {
    showProfileMessage(
      errorElement,
      "Profiles cannot be changed because the saved profile data could not be safely loaded. Your existing data was left untouched.",
      true,
    );
    return false;
  }

  if (!persistProfileState(nextState)) {
    showProfileMessage(
      errorElement,
      "The change could not be saved in this browser. Check browser storage settings and try again.",
      true,
    );
    return false;
  }
  profileState = nextState;
  return true;
}

function setActiveProfile(profileId) {
  if (!profileState.profiles.some((profile) => profile.id === profileId)) {
    return;
  }
  const nextState = { ...profileState, activeProfileId: profileId };
  if (saveProfileState(nextState, document.getElementById("profile-manager-message"))) {
    renderProfileList();
  }
}

function requestProfileDeletion(profileId) {
  profilePendingDeletionId = profileId;
  renderProfileList();
}

function confirmProfileDeletion() {
  const remainingProfiles = profileState.profiles.filter(
    (profile) => profile.id !== profilePendingDeletionId,
  );
  const wasActive = profilePendingDeletionId === profileState.activeProfileId;
  const nextState = {
    profiles: remainingProfiles,
    activeProfileId: wasActive
      ? (remainingProfiles[0] ? remainingProfiles[0].id : null)
      : profileState.activeProfileId,
  };
  if (saveProfileState(nextState, document.getElementById("profile-manager-message"))) {
    profilePendingDeletionId = null;
    if (profileBeingEditedId && !remainingProfiles.some((p) => p.id === profileBeingEditedId)) {
      showProfileForm();
    }
    renderProfileList();
    if (remainingProfiles.length === 0) {
      showProfileForm();
    }
  }
}

function getBackupPreviewSummary(plan) {
  const profileWord = plan.profilesAdded === 1 ? "profile" : "profiles";
  const mmrWord = plan.mmrUpdatesAdded === 1 ? "MMR record" : "MMR records";
  const automaticMmrWord = plan.automaticMmrSamplesAdded === 1
    ? "automatic MMR sample"
    : "automatic MMR samples";
  const matchWord = plan.matchRecordsAdded === 1 ? "match record" : "match records";
  const summary = [
    `Add ${plan.profilesAdded} ${profileWord}`,
    `${plan.duplicateProfiles} already exist`,
    `add ${plan.mmrUpdatesAdded} ${mmrWord}`,
    `add ${plan.automaticMmrSamplesAdded} ${automaticMmrWord}`,
    `add ${plan.matchRecordsAdded} ${matchWord}`,
  ];
  if (plan.automaticMmrSamplesSkipped) {
    summary.push(`${plan.automaticMmrSamplesSkipped} automatic MMR sample(s) skipped to prevent account mismatch`);
  }
  if (plan.conflictingIds) {
    summary.push(`${plan.conflictingIds} conflicting profile ID(s) will be reassigned`);
  }
  if (plan.activeProfileChanged) {
    summary.push("the backup's active profile will be selected because no local profile is active");
  }
  if (plan.legacyProfileAdded) {
    summary.push("the legacy profile copy will be restored because no local copy exists");
  }
  return `${summary.join("; ")}.`;
}

async function handleBackupFileChange(event) {
  const fileInput = event.currentTarget;
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    return;
  }

  const preview = document.getElementById("backup-import-preview");
  preview.hidden = true;
  pendingBackupImport = null;
  try {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Backup files must be 10 MB or smaller.");
    }
    const backup = validateBackup(JSON.parse(await file.text()));
    const plan = createBackupImportPlan(backup);
    pendingBackupImport = { backup, plan };
    document.getElementById("backup-preview-summary").textContent =
      getBackupPreviewSummary(plan);
    preview.hidden = false;
    clearProfileMessage(document.getElementById("profile-manager-message"));
  } catch (error) {
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      error instanceof Error
        ? `Backup import was rejected: ${error.message}`
        : "Backup import was rejected. No data was changed.",
      true,
    );
  } finally {
    fileInput.value = "";
  }
}

function cancelBackupImport() {
  pendingBackupImport = null;
  document.getElementById("backup-import-preview").hidden = true;
}

function confirmBackupImport() {
  if (!pendingBackupImport) {
    return;
  }

  let plan;
  try {
    plan = createBackupImportPlan(pendingBackupImport.backup);
  } catch (error) {
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      error instanceof Error
        ? `Backup import was stopped: ${error.message}`
        : "Backup import was stopped because current data changed.",
      true,
    );
    cancelBackupImport();
    return;
  }

  if (getBackupPreviewSummary(plan) !== getBackupPreviewSummary(pendingBackupImport.plan)) {
    pendingBackupImport.plan = plan;
    document.getElementById("backup-preview-summary").textContent =
      getBackupPreviewSummary(plan);
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      "Local data changed after the preview. Review the updated counts and confirm again.",
      true,
    );
    return;
  }

  const result = commitBackupImport(plan);
  if (result.error) {
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      result.error,
      true,
    );
    return;
  }

  profileState = {
    profiles: plan.profileState.profiles,
    activeProfileId: plan.profileState.activeProfileId,
  };
  manualMmrHistory = plan.manualMmrHistory.updates;
  automaticMmrHistory = plan.automaticMmrHistory.samples;
  pendingBackupImport = null;
  closeProfileForm();
  document.getElementById("backup-import-preview").hidden = true;
  renderProfileList();

  const importedCounts = getBackupPreviewSummary(plan);
  showProfileMessage(
    document.getElementById("profile-manager-message"),
    `Backup merged successfully. ${importedCounts}`,
    false,
  );
  if (plan.matchRecordsAdded > 0) {
    document.getElementById("profile-manager-message").textContent +=
      " Reloading to show restored match history.";
    window.setTimeout(() => window.location.reload(), 700);
  }
}

function initializeProfileSetup() {
  const profileForm = document.getElementById("profile-form");
  const profileMessage = document.getElementById("profile-message");
  const confirmationMessage = document.getElementById("confirmation-message");
  const reviewCheckbox = document.getElementById("profile-reviewed");
  const saveButton = document.getElementById("save-profile");
  document.getElementById("profile-storage-origin").textContent =
    window.location.origin === "null"
      ? "file:// (browser-specific)"
      : window.location.origin;

  const loaded = loadProfileState();
  if (loaded.error) {
    profileStorageBlocked = loaded.blocked;
    setProfileStatus("STORAGE ISSUE", false);
    showProfileMessage(
      document.getElementById("profile-manager-message"),
      loaded.error,
      true,
    );
  } else {
    profileState = loaded.state;
    renderProfileList();
    if (profileState.profiles.length > 0) {
      document.getElementById("profile-form").hidden = true;
    }
  }

  document.getElementById("export-backup").addEventListener("click", exportBackup);
  document.getElementById("import-backup").addEventListener("click", () => {
    document.getElementById("backup-file").click();
  });
  document.getElementById("backup-file").addEventListener("change", handleBackupFileChange);
  document.getElementById("cancel-backup-import").addEventListener("click", cancelBackupImport);
  document.getElementById("confirm-backup-import").addEventListener("click", confirmBackupImport);

  document.getElementById("add-profile").addEventListener("click", () => {
    profilePendingConfirmation = null;
    clearProfileMessage(profileMessage);
    showProfileForm();
  });

  // Username-only search is intentionally unavailable; no network request is made.
  document.getElementById("username-lookup").addEventListener("click", () => {
    showProfileMessage(
      profileMessage,
      "Username lookup is unavailable in Stage 2A; no search was attempted. If Tracker shows multiple matches, choose the correct profile there. If a profile is unavailable or fails to load, check it on Tracker, then paste its exact URL here.",
      true,
    );
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearProfileMessage(profileMessage);

    const platform = document.getElementById("profile-platform").value;
    const username = document.getElementById("profile-username").value.trim();
    const nickname = document.getElementById("profile-nickname").value.trim();
    const profileUrlInput = document.getElementById("profile-url").value.trim();

    if (!username) {
      showProfileMessage(profileMessage, "Enter your Rocket League username.", true);
      document.getElementById("profile-username").focus();
      return;
    }

    if (!profileUrlInput) {
      showProfileMessage(
        profileMessage,
        "A Tracker profile URL is required. Search for the profile on Tracker Network and paste its URL here; this app cannot search by username.",
        true,
      );
      document.getElementById("profile-url").focus();
      return;
    }

    const validation = validateTrackerProfileUrl(profileUrlInput, platform);
    if (validation.error) {
      showProfileMessage(profileMessage, validation.error, true);
      document.getElementById("profile-url").focus();
      return;
    }

    showProfileConfirmation({
      id: profileBeingEditedId || createProfileId(),
      platform,
      username,
      nickname,
      profileUrl: validation.url,
    });
  });

  reviewCheckbox.addEventListener("change", () => {
    saveButton.disabled = !reviewCheckbox.checked;
  });

  document.getElementById("back-to-profile").addEventListener("click", () => {
    const existing = profileState.profiles.find(
      (profile) => profile.id === profileBeingEditedId,
    );
    showProfileForm(profilePendingConfirmation || existing || null);
    renderProfileList();
  });

  saveButton.addEventListener("click", () => {
    if (!profilePendingConfirmation || !reviewCheckbox.checked) {
      showProfileMessage(
        confirmationMessage,
        "Review the profile link and confirm the checkbox before saving.",
        true,
      );
      return;
    }

    const existingProfile = profileState.profiles.find(
      (profile) => profile.id === profilePendingConfirmation.id,
    );
    const profileToSave = {
      ...existingProfile,
      ...profilePendingConfirmation,
      ...(existingProfile
        && existingProfile.platform !== profilePendingConfirmation.platform
        ? { gameAccountFingerprint: undefined }
        : {}),
      savedAt: new Date().toISOString(),
      role: getProfileRole(profilePendingConfirmation.id),
    };
    const existingIndex = profileState.profiles.findIndex(
      (profile) => profile.id === profileToSave.id,
    );
    const profiles = [...profileState.profiles];
    if (existingIndex === -1) {
      profiles.push(profileToSave);
    } else {
      profiles[existingIndex] = profileToSave;
    }
    const nextState = {
      profiles,
      activeProfileId: profileState.activeProfileId || profileToSave.id,
    };
    if (!saveProfileState(nextState, confirmationMessage)) {
      return;
    }

    profilePendingConfirmation = null;
    profileBeingEditedId = null;
    document.getElementById("profile-confirmation").hidden = true;
    document.getElementById("profile-form").hidden = true;
    renderProfileList();
  });

  document.getElementById("cancel-profile-edit").addEventListener("click", () => {
    closeProfileForm();
    renderProfileList();
  });

  document.getElementById("cancel-delete").addEventListener("click", () => {
    profilePendingDeletionId = null;
    renderProfileList();
  });

  document.getElementById("confirm-delete").addEventListener("click", () => {
    confirmProfileDeletion();
  });
}

function getProfileRole(profileId) {
  const existingProfile = profileState.profiles.find(
    (profile) => profile.id === profileId,
  );
  return existingProfile ? existingProfile.role || "player" : "player";
}

function loadManualMmrHistory() {
  let stored;
  try {
    stored = localStorage.getItem(MANUAL_MMR_STORAGE_KEY);
  } catch {
    mmrStorageBlocked = true;
    showProfileMessage(
      document.getElementById("mmr-message"),
      "Manual MMR storage is unavailable in this browser.",
      true,
    );
    return;
  }
  if (!stored) {
    return;
  }

  try {
    const data = JSON.parse(stored);
    if (!isValidManualMmrHistory(data)) {
      throw new Error("Invalid MMR history");
    }
    manualMmrHistory = data.updates;
  } catch {
    mmrStorageBlocked = true;
    showProfileMessage(
      document.getElementById("mmr-message"),
      "Manual MMR history could not be validated and was left untouched.",
      true,
    );
  }
}

function loadAutomaticMmrHistory() {
  let stored;
  try {
    stored = localStorage.getItem(AUTOMATIC_MMR_STORAGE_KEY);
  } catch {
    automaticMmrStorageBlocked = true;
    setAutomaticMmrStatus({
      status: "storage-error",
      message: "Automatic MMR storage is unavailable. Existing records were left untouched.",
    });
    return;
  }
  if (!stored) {
    return;
  }

  try {
    const data = JSON.parse(stored);
    if (!isValidAutomaticMmrHistory(data)) {
      throw new Error("Invalid automatic MMR history");
    }
    automaticMmrHistory = data.samples;
  } catch {
    automaticMmrStorageBlocked = true;
    setAutomaticMmrStatus({
      status: "storage-error",
      message: "Automatic MMR history could not be validated and was left untouched.",
    });
  }
}

function setAutomaticMmrStatus(status) {
  mmrHelperStatus = status;
  const statusElement = document.getElementById("automatic-mmr-status");
  statusElement.dataset.status = status.status;
  statusElement.textContent = status.message;
}

function getProfilePlatformFromAccount(platform) {
  const platformKey = String(platform || "").toLowerCase();
  return {
    epic: "epic",
    steam: "steam",
    psn: "playstation",
    playstation: "playstation",
    ps4: "playstation",
    ps5: "playstation",
    xbox: "xbox",
    xboxone: "xbox",
  }[platformKey] || null;
}

function updateAccountLinkPrompt(account, profile) {
  const confirmation = document.getElementById("account-link-confirmation");
  const description = document.getElementById("account-link-description");
  const confirmButton = document.getElementById("confirm-account-link");
  if (!account || !profile) {
    confirmation.hidden = true;
    pendingAccountLink = null;
    return;
  }

  pendingAccountLink = {
    fingerprint: account.fingerprint,
    platform: account.platform,
    targetProfileId: profile.id,
  };
  const platformMatches =
    profile.platform === getProfilePlatformFromAccount(account.platform);
  description.textContent =
    `Rocket League is signed in as ${account.displayName || "an account"} (${account.platform}). ${
      platformMatches
        ? `Link it to ${profile.nickname || profile.username}?`
        : `The active profile uses ${PLATFORM_NAMES[profile.platform]}, which does not match this account.`
    }`;
  confirmButton.disabled =
    !platformMatches || profileStorageBlocked;
  confirmation.hidden = false;
}

function handleRocketLeagueAccount(account) {
  if (!account) {
    detectedRocketLeagueAccount = null;
    dismissedAccountFingerprint = null;
    updateAccountLinkPrompt(null, null);
    setAutomaticMmrStatus({
      status: "waiting-for-game",
      message: "Waiting for Rocket League's signed-in account and a Ranked 2v2 search.",
    });
    return;
  }
  if (
    typeof account.fingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(account.fingerprint)
    || typeof account.platform !== "string"
  ) {
    setAutomaticMmrStatus({
      status: "error-reading-log",
      message: "The local helper reported an invalid account identity; no MMR was saved.",
    });
    return;
  }

  detectedRocketLeagueAccount = account;
  const linkedProfile = profileState.profiles.find(
    (profile) => profile.gameAccountFingerprint === account.fingerprint,
  );
  if (linkedProfile) {
    updateAccountLinkPrompt(null, null);
    setAutomaticMmrStatus({
      status: mmrHelperStatus.status === "mmr-detected" ? "mmr-detected" : "waiting-for-matchmaking",
      message: `Rocket League account is linked to ${linkedProfile.nickname || linkedProfile.username}. Waiting for the next solo Ranked 2v2 search.`,
    });
    if (
      pendingAutomaticMmrSample
      && pendingAutomaticMmrSample.accountFingerprint === account.fingerprint
    ) {
      saveAutomaticMmrSample(pendingAutomaticMmrSample);
    }
    return;
  }

  if (dismissedAccountFingerprint === account.fingerprint) {
    updateAccountLinkPrompt(null, null);
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: "Confirm the detected Rocket League account before saving automatic MMR.",
    });
    return;
  }

  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    updateAccountLinkPrompt(null, null);
    const detectedPlatform = getProfilePlatformFromAccount(account.platform);
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: `Select an active ${PLATFORM_NAMES[detectedPlatform] || account.platform} profile, then confirm the detected Rocket League account.`,
    });
    return;
  }

  updateAccountLinkPrompt(account, activeProfile);
  setAutomaticMmrStatus({
    status: "account-confirmation-required",
    message: "Confirm the Rocket League account before any automatic MMR can be saved.",
  });
}

function isValidDetectedMmrSample(sample) {
  return sample
    && typeof sample.sampleId === "string"
    && /^[a-f0-9]{64}$/.test(sample.sampleId)
    && typeof sample.accountFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(sample.accountFingerprint)
    && typeof sample.platform === "string"
    && sample.playlistId === 11
    && sample.partySize === 1
    && Number.isFinite(sample.rawPartyLeaderMmr)
    && sample.rawPartyLeaderMmr > 0
    && sample.rawPartyLeaderMmr <= 494.95
    && sample.calculatedMmr === Number(((sample.rawPartyLeaderMmr * 20) + 100).toFixed(3))
    && sample.calculatedMmr <= 9999
    && sample.mmr === Math.round(sample.calculatedMmr * 10) / 10
    && typeof sample.observedAt === "string"
    && !Number.isNaN(Date.parse(sample.observedAt));
}

function saveAutomaticMmrSample(sample) {
  pendingAutomaticMmrSample = null;
  if (!isValidDetectedMmrSample(sample)) {
    setAutomaticMmrStatus({
      status: "error-reading-log",
      message: "An invalid MMR sample was rejected; no data was saved.",
    });
    return;
  }
  if (automaticMmrStorageBlocked) {
    setAutomaticMmrStatus({
      status: "storage-error",
      message: "Automatic MMR storage is unavailable; existing history was left untouched.",
    });
    return;
  }

  const profile = profileState.profiles.find(
    (candidate) => candidate.gameAccountFingerprint === sample.accountFingerprint,
  );
  if (!profile) {
    pendingAutomaticMmrSample = sample;
    handleRocketLeagueAccount(detectedRocketLeagueAccount);
    return;
  }
  if (profile.platform !== getProfilePlatformFromAccount(sample.platform)) {
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: "The linked profile platform does not match the detected Rocket League account. No MMR was saved.",
    });
    return;
  }

  if (automaticMmrHistory.some((update) =>
    update.profileId === profile.id && update.sampleId === sample.sampleId)) {
    setAutomaticMmrStatus({
      status: "mmr-detected",
      message: `This Ranked 2v2 MMR sample was already saved for ${profile.nickname || profile.username}.`,
    });
    return;
  }

  const update = {
    profileId: profile.id,
    sampleId: sample.sampleId,
    playlistId: 11,
    rawPartyLeaderMmr: sample.rawPartyLeaderMmr,
    calculatedMmr: sample.calculatedMmr,
    mmr: sample.mmr,
    updatedAt: sample.observedAt,
    source: "launch-log",
  };
  const nextHistory = [update, ...automaticMmrHistory]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  try {
    localStorage.setItem(
      AUTOMATIC_MMR_STORAGE_KEY,
      JSON.stringify({ version: 1, samples: nextHistory }),
    );
  } catch {
    automaticMmrStorageBlocked = true;
    setAutomaticMmrStatus({
      status: "storage-error",
      message: "The automatic MMR sample could not be saved. Existing history was left untouched.",
    });
    return;
  }

  automaticMmrHistory = nextHistory;
  setAutomaticMmrStatus({
    status: "mmr-detected",
    message: `Confirmed Ranked 2v2 MMR saved for ${profile.nickname || profile.username}.`,
  });
  if (getActiveProfile() && getActiveProfile().id === profile.id) {
    renderManualMmr();
  }
}

function confirmRocketLeagueAccountLink() {
  if (!pendingAccountLink || !detectedRocketLeagueAccount) {
    return;
  }
  const activeProfile = getActiveProfile();
  if (
    !activeProfile
    || activeProfile.id !== pendingAccountLink.targetProfileId
    || pendingAccountLink.fingerprint !== detectedRocketLeagueAccount.fingerprint
    || activeProfile.platform !== getProfilePlatformFromAccount(pendingAccountLink.platform)
  ) {
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: "The active profile or detected account changed. Review the account link again.",
    });
    handleRocketLeagueAccount(detectedRocketLeagueAccount);
    return;
  }

  const alreadyLinked = profileState.profiles.find(
    (profile) => profile.gameAccountFingerprint === pendingAccountLink.fingerprint,
  );
  if (alreadyLinked && alreadyLinked.id !== activeProfile.id) {
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: `This Rocket League account is already linked to ${alreadyLinked.nickname || alreadyLinked.username}.`,
    });
    return;
  }

  const nextProfile = {
    ...activeProfile,
    gameAccountFingerprint: pendingAccountLink.fingerprint,
  };
  const nextState = {
    ...profileState,
    profiles: profileState.profiles.map((profile) =>
      profile.id === activeProfile.id ? nextProfile : profile),
  };
  if (!saveProfileState(nextState, document.getElementById("mmr-message"))) {
    return;
  }

  const queuedSample = pendingAutomaticMmrSample;
  pendingAutomaticMmrSample = null;
  updateAccountLinkPrompt(null, null);
  setAutomaticMmrStatus({
    status: "waiting-for-matchmaking",
    message: `Rocket League account linked to ${activeProfile.nickname || activeProfile.username}. Waiting for a solo Ranked 2v2 search.`,
  });
  renderProfileList();
  if (queuedSample) {
    saveAutomaticMmrSample(queuedSample);
  }
}

function handleAutomaticMmrStatus(status) {
  if (!status || typeof status.status !== "string" || typeof status.message !== "string") {
    setAutomaticMmrStatus({
      status: "error-reading-log",
      message: "The local MMR helper sent an invalid status.",
    });
    return;
  }

  if (automaticMmrStorageBlocked) {
    setAutomaticMmrStatus({
      status: "storage-error",
      message: "Automatic MMR storage is unavailable; existing history was left untouched.",
    });
    return;
  }

  if (
    detectedRocketLeagueAccount
    && !profileState.profiles.some(
      (profile) => profile.gameAccountFingerprint === detectedRocketLeagueAccount.fingerprint,
    )
    && ![
      "helper-unavailable",
      "disconnected",
      "error-reading-log",
      "waiting-for-game",
    ].includes(status.status)
  ) {
    handleRocketLeagueAccount(detectedRocketLeagueAccount);
    return;
  }
  setAutomaticMmrStatus(status);
}

function initializeAutomaticMmr() {
  loadAutomaticMmrHistory();
  renderManualMmr();
  document.getElementById("confirm-account-link").addEventListener(
    "click",
    confirmRocketLeagueAccountLink,
  );
  document.getElementById("cancel-account-link").addEventListener("click", () => {
    dismissedAccountFingerprint = detectedRocketLeagueAccount
      ? detectedRocketLeagueAccount.fingerprint
      : null;
    updateAccountLinkPrompt(null, null);
    setAutomaticMmrStatus({
      status: "account-confirmation-required",
      message: "Account confirmation is required before automatic MMR can be saved.",
    });
  });

  window.RLMMRBridge.connect({
    onStatus: handleAutomaticMmrStatus,
    onAccount: handleRocketLeagueAccount,
    onSample: (sample) => {
      if (!isValidDetectedMmrSample(sample)) {
        saveAutomaticMmrSample(sample);
        return;
      }
      if (
        !detectedRocketLeagueAccount
        || detectedRocketLeagueAccount.fingerprint !== sample.accountFingerprint
      ) {
        detectedRocketLeagueAccount = {
          fingerprint: sample.accountFingerprint,
          platform: sample.platform,
          displayName: "Rocket League account",
        };
      }
      if (!profileState.profiles.some(
        (profile) => profile.gameAccountFingerprint === sample.accountFingerprint,
      )) {
        pendingAutomaticMmrSample = sample;
        handleRocketLeagueAccount(detectedRocketLeagueAccount);
        return;
      }
      saveAutomaticMmrSample(sample);
    },
    onRejected: (event) => {
      if (event && typeof event.reason === "string"
        && event.reason.includes("party leader cannot be verified")) {
        setAutomaticMmrStatus({
          status: "party-leader-unverified",
          message: event.reason,
        });
      } else {
        setAutomaticMmrStatus({
          status: "waiting-for-matchmaking",
          message: event && typeof event.reason === "string"
            ? event.reason
            : "No confirmed solo Ranked 2v2 sample was found.",
        });
      }
    },
    onError: (message) => {
      setAutomaticMmrStatus({
        status: "error-reading-log",
        message,
      });
    },
  });
}

function formatRankProgressMmr(mmr) {
  return mmr.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function renderRankProgress(mmr, emptyMessage) {
  const progress = window.RLRankProgress.calculateRankProgress(mmr);
  const rankLabel = document.getElementById("rank-progress-heading");
  const divisionLabel = document.getElementById("rank-progress-division");
  const content = document.getElementById("rank-progress-content");
  const empty = document.getElementById("rank-progress-empty");

  if (!progress) {
    rankLabel.textContent = "Rank Progress";
    divisionLabel.hidden = true;
    content.hidden = true;
    empty.hidden = false;
    empty.textContent = emptyMessage;
    return;
  }

  rankLabel.textContent = progress.rankName;
  divisionLabel.hidden = false;
  divisionLabel.textContent = progress.isTopRank
    ? "NO DIVISIONS"
    : `DIVISION ${progress.divisionName}`;
  content.hidden = false;
  empty.hidden = true;

  const progressBar = document.getElementById("rank-progress-bar");
  const progressFill = document.getElementById("rank-progress-fill");
  const progressPercent = document.getElementById("rank-progress-percent");
  progressFill.style.width = `${progress.progressPercent}%`;
  progressBar.setAttribute("aria-valuenow", String(Math.round(progress.progressPercent)));
  progressBar.setAttribute(
    "aria-valuetext",
    progress.isTopRank
      ? "Supersonic Legend, top rank"
      : `${Math.round(progress.progressPercent)}% through ${progress.rankName} Division ${progress.divisionName}`,
  );
  progressPercent.textContent = progress.isTopRank
    ? "TOP RANK"
    : `${Math.round(progress.progressPercent)}%`;

  const divisionRemaining = document.getElementById("rank-progress-division-remaining");
  const nextDivision = document.getElementById("rank-progress-next-division");
  const rankRemaining = document.getElementById("rank-progress-rank-remaining");
  const nextRank = document.getElementById("rank-progress-next-rank");
  divisionRemaining.textContent = progress.mmrRemainingToNextDivision === null
    ? "No further divisions"
    : `${formatRankProgressMmr(progress.mmrRemainingToNextDivision)} MMR`;
  nextDivision.textContent = progress.nextDivisionName
    || "Supersonic Legend has no divisions";
  rankRemaining.textContent = progress.mmrRemainingToNextRank === null
    ? "Top rank reached"
    : `${formatRankProgressMmr(progress.mmrRemainingToNextRank)} MMR`;
  nextRank.textContent = progress.nextRankName || "Supersonic Legend";
}

function renderManualMmr() {
  const activeProfile = getActiveProfile();
  const input = document.getElementById("mmr-input");
  const submitButton = document.querySelector("#mmr-form button[type='submit']");
  const currentValue = document.getElementById("current-mmr");
  const updatedLabel = document.getElementById("current-mmr-updated");
  const historyList = document.getElementById("mmr-history-list");
  const historyCount = document.getElementById("mmr-history-count");
  const sourceLabel = document.getElementById("mmr-source-label");

  input.disabled = !activeProfile || mmrStorageBlocked;
  submitButton.disabled = !activeProfile || mmrStorageBlocked;
  historyList.replaceChildren();

  if (!activeProfile) {
    currentValue.textContent = "—";
    updatedLabel.textContent = "Select an active profile to manage MMR";
    sourceLabel.textContent = "WAITING FOR DATA";
    historyCount.textContent = "0 UPDATES";
    renderRankProgress(
      null,
      "Select a profile with saved MMR to see Ranked 2v2 progress.",
    );
    const empty = document.createElement("li");
    empty.className = "empty-history";
    empty.textContent = "Select a profile to view its MMR history.";
    historyList.append(empty);
    return;
  }

  const updates = [
    ...manualMmrHistory
      .filter((update) => update.profileId === activeProfile.id)
      .map((update) => ({ ...update, sourceLabel: "MANUAL" })),
    ...automaticMmrHistory
      .filter((update) => update.profileId === activeProfile.id)
      .map((update) => ({ ...update, sourceLabel: "AUTO · GAME LOG" })),
  ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  historyCount.textContent = `${updates.length} UPDATE${updates.length === 1 ? "" : "S"}`;
  if (updates.length === 0) {
    currentValue.textContent = "—";
    sourceLabel.textContent = "WAITING FOR DATA";
    updatedLabel.textContent = "No MMR update recorded";
    renderRankProgress(
      null,
      "Add a manual Ranked 2v2 value or wait for a confirmed automatic sample.",
    );
    const empty = document.createElement("li");
    empty.className = "empty-history";
    empty.textContent = "No MMR updates yet.";
    historyList.append(empty);
    return;
  }

  currentValue.textContent = updates[0].mmr.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  renderRankProgress(
    updates[0].mmr,
    "No valid Ranked 2v2 MMR is available for rank progress.",
  );
  sourceLabel.textContent = updates[0].sourceLabel;
  updatedLabel.textContent =
    `Updated ${new Date(updates[0].updatedAt).toLocaleString()} · ${
      updates[0].sourceLabel === "MANUAL" ? "manually entered" : "confirmed from Launch.log · Ranked 2v2"
    }`;
  updates.slice(0, 10).forEach((update) => {
    const item = document.createElement("li");
    item.className = "mmr-history-item";
    const value = document.createElement("strong");
    value.textContent = `${update.mmr.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })} MMR · ${update.sourceLabel}`;
    const date = document.createElement("span");
    date.textContent = new Date(update.updatedAt).toLocaleString();
    item.append(value, date);
    historyList.append(item);
  });
}

function initializeManualMmr() {
  loadManualMmrHistory();
  renderManualMmr();
  document.getElementById("mmr-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const message = document.getElementById("mmr-message");
    const activeProfile = getActiveProfile();
    const input = document.getElementById("mmr-input");
    const mmr = Number(input.value);

    if (!activeProfile) {
      showProfileMessage(message, "Select an active profile before saving MMR.", true);
      return;
    }
    if (!Number.isInteger(mmr) || mmr < 0 || mmr > 99999) {
      showProfileMessage(message, "Enter a whole-number MMR between 0 and 99,999.", true);
      return;
    }
    if (mmrStorageBlocked) {
      showProfileMessage(message, "Manual MMR history is unavailable and was left untouched.", true);
      return;
    }

    const update = {
      profileId: activeProfile.id,
      mmr,
      updatedAt: new Date().toISOString(),
    };
    const nextHistory = [update, ...manualMmrHistory];
    try {
      localStorage.setItem(
        MANUAL_MMR_STORAGE_KEY,
        JSON.stringify({ version: 1, updates: nextHistory }),
      );
    } catch {
      showProfileMessage(message, "MMR could not be saved in this browser. Check local storage settings.", true);
      return;
    }

    manualMmrHistory = nextHistory;
    input.value = "";
    clearProfileMessage(message);
    renderManualMmr();
  });
}

function updateLiveMatchDisplay(matchState = window.RLMatchTracker.getSnapshot()) {
  const matchLabel = document.getElementById("live-match-state");
  const rosterLabel = document.getElementById("live-match-roster");
  const activeProfile = getActiveProfile();

  if (matchState.phase === "waiting") {
    matchLabel.textContent = connectionState === "connected"
      ? "Connected · waiting for a match."
      : "Waiting for a match.";
    rosterLabel.textContent = "Players in match: —";
    return;
  }

  if (matchState.phase === "complete") {
    matchLabel.textContent = matchState.eventMessage || "Match complete.";
  } else {
    matchLabel.textContent = matchState.eventMessage || "Match in progress.";
  }
  if (!matchState.currentMatch || !matchState.currentMatch.localPlayerFound) {
    if (!activeProfile) {
      matchLabel.textContent = "Match detected · select an active profile to record its stats.";
    } else if (matchState.currentMatch && matchState.currentMatch.localPlayerAmbiguous) {
      matchLabel.textContent = "Match detected · multiple player names match the active profile.";
    }
  }
  rosterLabel.textContent = matchState.roster.length
    ? `Players in match: ${matchState.roster.join(", ")}`
    : "Players in match: waiting for roster data.";
}

function setConnectionStatus(connection) {
  connectionState = connection.status;
  const badge = document.getElementById("rl-connection-status");
  badge.dataset.status = connection.status;
  badge.textContent = connection.status.replace("-", " ").toUpperCase();
  document.getElementById("rl-connection-detail").textContent = connection.message;

  const connectButton = document.getElementById("connect-stats-api");
  const disconnectButton = document.getElementById("disconnect-stats-api");
  connectButton.disabled = ["connecting", "connected", "reconnecting"].includes(connection.status);
  disconnectButton.disabled = connection.status === "disconnected";
  updateLiveMatchDisplay();
  refreshPlayerDashboard();
}

function initializeMatchDashboard() {
  window.RLMatchTracker.initialize({
    onChange: (matchState) => {
      if (demoDataEnabled) {
        demoDataEnabled = false;
        document.getElementById("toggle-demo-data").textContent = "Show optional demo data";
        document.getElementById("toggle-demo-data").setAttribute("aria-pressed", "false");
      }
      updateLiveMatchDisplay(matchState);
      refreshPlayerDashboard();
    },
    onError: (message) => {
      document.getElementById("rl-connection-detail").textContent = message;
    },
  });
  updateLiveMatchDisplay();
}

function initializeLifecycleDiagnosticsControls() {
  const enabledInput = document.getElementById("lifecycle-diagnostics-enabled");
  const statusLabel = document.getElementById("lifecycle-diagnostics-status");
  const downloadButton = document.getElementById("download-lifecycle-diagnostics");
  const clearButton = document.getElementById("clear-lifecycle-diagnostics");
  const diagnostics = window.RLLifecycleDiagnostics;

  if (!diagnostics) {
    enabledInput.disabled = true;
    downloadButton.disabled = true;
    clearButton.disabled = true;
    statusLabel.textContent = "Diagnostics are unavailable because their local module did not load.";
    return;
  }

  const updateControls = (status) => {
    enabledInput.checked = status.enabled;
    downloadButton.disabled = status.entryCount === 0;
    clearButton.disabled = status.entryCount === 0;
    statusLabel.textContent = status.error
      || (status.enabled
        ? `Recording locally · ${status.entryCount} events saved.`
        : `Disabled · ${status.entryCount} saved events retained locally.`);
  };

  diagnostics.subscribe(updateControls);
  enabledInput.addEventListener("change", () => {
    diagnostics.setEnabled(enabledInput.checked);
  });
  clearButton.addEventListener("click", () => {
    diagnostics.clear();
  });
  downloadButton.addEventListener("click", () => {
    let objectUrl;
    try {
      const blob = new Blob([diagnostics.serialize()], {
        type: "application/json",
      });
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "rl-companion-lifecycle-diagnostics.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      statusLabel.textContent = "The diagnostic file could not be downloaded.";
    }
  });
}

function initializeStatsAPIControls() {
  const connectToStatsAPI = () => {
    window.RLStatsAPI.connect({
      onStatus: setConnectionStatus,
      onError: (message) => {
        document.getElementById("rl-connection-detail").textContent = message;
      },
      onEvent: (event) => {
        demoDataEnabled = false;
        window.RLMatchTracker.processEvent(event, getActiveProfile());
      },
    });
  };

  document.getElementById("connect-stats-api").addEventListener("click", connectToStatsAPI);

  document.getElementById("disconnect-stats-api").addEventListener("click", () => {
    window.RLStatsAPI.disconnect();
  });

  document.getElementById("toggle-demo-data").addEventListener("click", (event) => {
    demoDataEnabled = !demoDataEnabled;
    event.currentTarget.textContent = demoDataEnabled
      ? "Hide optional demo data"
      : "Show optional demo data";
    event.currentTarget.setAttribute("aria-pressed", String(demoDataEnabled));
    refreshPlayerDashboard();
  });

  initializeLifecycleDiagnosticsControls();
  setConnectionStatus({
    status: "waiting",
    message: "Waiting for Rocket League. RL Companion checks the local Stats API automatically.",
  });
  connectToStatsAPI();
}

renderSessionDate();
initializeModeSelector();
initializeManualMmr();
initializeMatchDashboard();
initializeProfileSetup();
initializeAutomaticMmr();
initializeStatsAPIControls();
