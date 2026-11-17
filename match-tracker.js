// Turns documented Stats API events into profile-scoped, persistent match records.
(function initializeMatchTracker() {
  const MATCH_STORAGE_KEY = "rl-companion.match-records.v1";
  const MAX_RECORDS = 500;
  const PLAYLISTS = {
    1: { mode: "casual", teamSize: 1, name: "Casual 1v1" },
    2: { mode: "casual", teamSize: 2, name: "Casual 2v2" },
    3: { mode: "casual", teamSize: 3, name: "Casual 3v3" },
    4: { mode: "casual", teamSize: 4, name: "Casual 4v4" },
    10: { mode: "ranked", teamSize: 1, name: "Ranked 1v1" },
    11: { mode: "ranked", teamSize: 2, name: "Ranked 2v2" },
    13: { mode: "ranked", teamSize: 3, name: "Ranked 3v3" },
  };

  let records = [];
  let currentMatch = null;
  let storageBlocked = false;
  let storageError = null;
  let onChange = () => {};
  let onError = () => {};

  function readRecords() {
    let stored;
    try {
      stored = localStorage.getItem(MATCH_STORAGE_KEY);
    } catch {
      storageBlocked = true;
      storageError = "Match history storage is unavailable in this browser.";
      return;
    }

    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (
        !parsed
        || parsed.version !== 1
        || !Array.isArray(parsed.records)
        || !parsed.records.every((record) =>
          record
          && typeof record.id === "string"
          && typeof record.profileId === "string"
          && typeof record.playedAt === "string")
      ) {
        throw new Error("Invalid saved match history");
      }
      records = parsed.records;
    } catch {
      storageBlocked = true;
      storageError = "Saved match history could not be validated and was left untouched.";
    }
  }

  function saveRecords(nextRecords) {
    if (storageBlocked) {
      onError(storageError || "Match history cannot be changed because saved data is invalid.");
      return false;
    }
    try {
      localStorage.setItem(
        MATCH_STORAGE_KEY,
        JSON.stringify({ version: 1, records: nextRecords }),
      );
      return true;
    } catch {
      onError("Match history could not be saved in this browser. Check local storage settings.");
      return false;
    }
  }

  function asCounter(value) {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function normalizeName(value) {
    return typeof value === "string"
      ? value.trim().normalize("NFC").toLocaleLowerCase()
      : "";
  }

  function getMatchGuid(data) {
    return typeof data.MatchGuid === "string" && data.MatchGuid
      ? data.MatchGuid
      : null;
  }

  function snapshot() {
    return {
      phase: currentMatch ? (currentMatch.ended ? "complete" : "in-match") : "waiting",
      matchGuid: currentMatch ? currentMatch.matchGuid : null,
      roster: currentMatch ? currentMatch.roster.slice() : [],
      eventMessage: currentMatch ? currentMatch.eventMessage : "",
      currentMatch: currentMatch
        ? {
          matchGuid: currentMatch.matchGuid,
          startedAt: currentMatch.startedAt,
          playlistId: currentMatch.playlistId,
          localPlayerFound: currentMatch.localPlayerFound,
          localPlayerAmbiguous: currentMatch.localPlayerAmbiguous,
          playerInfoAvailable: Boolean(currentMatch.localPlayerFound && currentMatch.localPlayer),
          teamInfoAvailable: currentMatch.teams.length > 0,
        }
        : null,
      storageError,
    };
  }

  function notify() {
    onChange(snapshot());
  }

  function createMatch(data, profile) {
    const now = new Date();
    const matchGuid = getMatchGuid(data);
    currentMatch = {
      id: matchGuid || `local-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      matchGuid,
      createdAt: now,
      startedAt: null,
      playlistId: null,
      ended: false,
      profileId: profile && profile.id ? profile.id : null,
      profileUsername: profile && profile.username ? profile.username : "",
      localPlayer: null,
      localPlayerPrimaryId: null,
      localPlayerFound: false,
      localPlayerAmbiguous: false,
      eventGoalCount: 0,
      eventAssistCount: 0,
      latestStats: { goals: 0, assists: 0, saves: 0, shots: 0 },
      teams: [],
      roster: [],
      participants: [],
      eventMessage: "Match detected. Waiting for player stats.",
    };
    return currentMatch;
  }

  function ensureCurrentMatch(data, profile) {
    const incomingGuid = getMatchGuid(data);
    if (
      currentMatch
      && incomingGuid
      && currentMatch.matchGuid
      && incomingGuid !== currentMatch.matchGuid
    ) {
      currentMatch = null;
    }
    if (!currentMatch) {
      return createMatch(data, profile);
    }
    if (incomingGuid && !currentMatch.matchGuid) {
      currentMatch.matchGuid = incomingGuid;
      currentMatch.id = incomingGuid;
    }
    return currentMatch;
  }

  function updateRoster(match, players) {
    const names = players
      .filter((player) => player && typeof player.Name === "string" && player.Name.trim())
      .map((player) => player.Name.trim());
    const previous = new Set(match.roster);
    const current = new Set(names);
    const joined = names.filter((name) => !previous.has(name));
    const left = match.roster.filter((name) => !current.has(name));

    let rosterChange = "";
    if (joined.length > 0 && match.roster.length > 0) {
      rosterChange = `${joined.join(", ")} joined the match.`;
    } else if (left.length > 0) {
      rosterChange = `${left.join(", ")} left the match.`;
    }
    match.roster = Array.from(current);
    match.participants = Array.from(new Set([...match.participants, ...current]));
    return rosterChange;
  }

  function findLocalPlayer(match, players) {
    const searchName = normalizeName(match.profileUsername);
    if (!searchName) {
      match.localPlayerFound = false;
      match.localPlayerAmbiguous = false;
      return null;
    }
    const matches = players.filter(
      (player) => player && normalizeName(player.Name) === searchName,
    );
    if (match.localPlayerPrimaryId) {
      const byId = matches.filter(
        (player) => player.PrimaryId === match.localPlayerPrimaryId,
      );
      if (byId.length === 1) {
        match.localPlayerAmbiguous = false;
        return byId[0];
      }
    }
    if (matches.length === 1) {
      match.localPlayerPrimaryId =
        typeof matches[0].PrimaryId === "string" ? matches[0].PrimaryId : null;
      match.localPlayerAmbiguous = false;
      match.localPlayerFound = true;
      return matches[0];
    }
    match.localPlayerAmbiguous = matches.length > 1;
    return null;
  }

  function updatePlayerStats(match, player) {
    if (!player) {
      return;
    }
    match.localPlayer = player;
    match.latestStats = {
      goals: Math.max(asCounter(player.Goals), match.eventGoalCount),
      assists: Math.max(asCounter(player.Assists), match.eventAssistCount),
      saves: asCounter(player.Saves),
      shots: asCounter(player.Shots),
    };
  }

  function updateGameState(match, data, profile) {
    if (!match.profileId && profile && profile.id) {
      match.profileId = profile.id;
      match.profileUsername = profile.username || "";
    }
    const game = data.Game && typeof data.Game === "object" ? data.Game : {};
    const players = Array.isArray(data.Players) ? data.Players : [];
    const rosterChange = updateRoster(match, players);
    if (Number.isInteger(game.PlaylistId)) {
      match.playlistId = game.PlaylistId;
    }
    match.teams = Array.isArray(game.Teams) ? game.Teams : match.teams;
    const localPlayer = findLocalPlayer(match, players);
    updatePlayerStats(match, localPlayer);
    if (localPlayer) {
      match.eventMessage = rosterChange || `Tracking ${localPlayer.Name}'s match stats.`;
    } else if (match.localPlayerAmbiguous) {
      match.eventMessage = match.localPlayerFound
        ? "The profile name is now ambiguous; retaining stats from the previously matched player."
        : "Several players match the active profile name; this match will not be attributed.";
    } else if (match.localPlayerFound) {
      match.eventMessage = rosterChange
        || `${match.profileUsername} is no longer in the live roster; last reported stats are retained.`;
    } else if (players.length > 0) {
      match.eventMessage = rosterChange
        || `Waiting for a player named "${match.profileUsername}" in the match roster.`;
    }
  }

  function countGoalEvent(match, data) {
    const scorer = data.Scorer && data.Scorer.Name;
    const assister = data.Assister && data.Assister.Name;
    if (normalizeName(scorer) === normalizeName(match.profileUsername)) {
      match.eventGoalCount += 1;
      match.eventMessage = `${scorer} scored.`;
    }
    if (normalizeName(assister) === normalizeName(match.profileUsername)) {
      match.eventAssistCount += 1;
      match.eventMessage = `${assister} recorded an assist.`;
    }
    if (match.localPlayer) {
      updatePlayerStats(match, match.localPlayer);
    }
  }

  function findTeam(teams, teamNum) {
    return teams.find((team) => team && Number(team.TeamNum) === teamNum);
  }

  function persistCompletedMatch(match, data) {
    if (!match.profileId || !match.localPlayerFound || !match.localPlayer) {
      if (!match.localPlayerFound) {
        match.eventMessage = match.localPlayerAmbiguous
          ? "Match ended; no record saved because the active profile name matched multiple players."
          : `Match ended; no record saved because "${match.profileUsername}" was not found in the roster.`;
      }
      return;
    }

    if (
      records.some((record) =>
        record.profileId === match.profileId
        && (record.id === match.id
          || (match.matchGuid && record.matchGuid === match.matchGuid)))
    ) {
      match.eventMessage = "This match is already in history; duplicate event ignored.";
      return;
    }

    const endedAt = new Date();
    const playedAt = match.startedAt || match.createdAt;
    const localTeamNum = match.localPlayer.TeamNum;
    const winnerTeamNum = data.WinnerTeamNum;
    const winnerKnown =
      Number.isInteger(localTeamNum) && Number.isInteger(winnerTeamNum);
    const result = winnerKnown
      ? (winnerTeamNum === localTeamNum ? "win" : "loss")
      : "unknown";
    const localTeam = findTeam(match.teams, localTeamNum);
    const opponentTeam = match.teams.find(
      (team) => team && Number(team.TeamNum) !== localTeamNum,
    );

    const record = {
      id: match.id,
      matchGuid: match.matchGuid,
      profileId: match.profileId,
      playedAt: playedAt.toISOString(),
      playlistId: match.playlistId,
      result,
      goalsFor: localTeam ? asCounter(localTeam.Score) : null,
      goalsAgainst: opponentTeam ? asCounter(opponentTeam.Score) : null,
      goals: match.latestStats.goals,
      assists: match.latestStats.assists,
      saves: match.latestStats.saves,
      shots: match.latestStats.shots,
      durationSeconds: Math.max(0, Math.round((endedAt - playedAt) / 1000)),
      players: match.participants.slice(),
      localPlayerName: match.localPlayer.Name,
    };

    const nextRecords = [record, ...records].slice(0, MAX_RECORDS);
    if (saveRecords(nextRecords)) {
      records = nextRecords;
      match.ended = true;
      match.eventMessage = result === "unknown"
        ? "Match ended; winner was not provided, so the result is unknown."
        : `Match recorded as a ${result}.`;
    }
  }

  function processEvent(event, profile) {
    if (!event || typeof event.Event !== "string" || !event.Data || typeof event.Data !== "object") {
      onError("A Stats API event was ignored because its format was invalid.");
      return;
    }

    const name = event.Event;
    const data = event.Data;

    if (name === "MatchCreated") {
      const guid = getMatchGuid(data);
      if (!currentMatch || !guid || currentMatch.matchGuid !== guid) {
        createMatch(data, profile);
      }
      notify();
      return;
    }

    if (name === "MatchDestroyed") {
      currentMatch = null;
      notify();
      return;
    }

    if (name === "MatchInitialized" || name === "CountdownBegin" || name === "RoundStarted") {
      const match = ensureCurrentMatch(data, profile);
      if (!match.startedAt) {
        match.startedAt = new Date();
      }
      match.eventMessage = "Match in progress.";
      notify();
      return;
    }

    if (name === "UpdateState") {
      if (!currentMatch && !getMatchGuid(data) && !data.Game) {
        return;
      }
      const match = ensureCurrentMatch(data, profile);
      updateGameState(match, data, profile);
      notify();
      return;
    }

    if (name === "GoalScored") {
      const match = ensureCurrentMatch(data, profile);
      countGoalEvent(match, data);
      notify();
      return;
    }

    if (name === "MatchEnded") {
      if (!currentMatch) {
        return;
      }
      if (getMatchGuid(data) && currentMatch.matchGuid && getMatchGuid(data) !== currentMatch.matchGuid) {
        return;
      }
      persistCompletedMatch(currentMatch, data);
      notify();
    }
  }

  function getMatches(profileId, mode) {
    return records
      .filter((record) =>
        record.profileId === profileId
        && (mode === undefined || getPlaylistMode(record.playlistId) === mode))
      .slice()
      .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  }

  function getPlaylistInfo(playlistId) {
    if (!Number.isInteger(playlistId) || !PLAYLISTS[playlistId]) {
      return null;
    }
    return { playlistId, ...PLAYLISTS[playlistId] };
  }

  function getPlaylistMode(playlistId) {
    const playlist = getPlaylistInfo(playlistId);
    return playlist ? playlist.mode : null;
  }

  function getPlaylistName(playlistId) {
    const playlist = getPlaylistInfo(playlistId);
    return playlist ? playlist.name : "Unknown";
  }

  function initialize(options) {
    onChange = options.onChange || onChange;
    onError = options.onError || onError;
    readRecords();
    if (storageError) {
      onError(storageError);
    }
    notify();
  }

  readRecords();
  window.RLMatchTracker = {
    initialize,
    processEvent,
    getMatches,
    getPlaylistInfo,
    getPlaylistMode,
    getPlaylistName,
    getSnapshot: snapshot,
  };
})();
