(function exposeRankProgress() {
  const thresholds = typeof module === "object" && module.exports
    ? require("./rank-thresholds")
    : window.RLRankThresholds;
  const DIVISION_NAMES = ["I", "II", "III", "IV"];
  const MIN_MMR = thresholds[0].divisions[0];
  const MAX_MMR = 99999;

  const divisionThresholds = thresholds.flatMap((rank, rankIndex) => {
    if (!Array.isArray(rank.divisions)) {
      return [{
        rankName: rank.rank,
        rankIndex,
        divisionName: null,
        startMmr: rank.mmr,
        isTopRank: true,
      }];
    }
    return rank.divisions.map((startMmr, divisionIndex) => ({
      rankName: rank.rank,
      rankIndex,
      divisionName: DIVISION_NAMES[divisionIndex],
      startMmr,
      isTopRank: false,
    }));
  });

  function calculateRankProgress(mmr) {
    if (!Number.isFinite(mmr) || mmr < MIN_MMR || mmr > MAX_MMR) {
      return null;
    }

    let currentIndex = -1;
    for (let index = 0; index < divisionThresholds.length; index += 1) {
      if (mmr < divisionThresholds[index].startMmr) {
        break;
      }
      currentIndex = index;
    }
    if (currentIndex < 0) {
      return null;
    }

    const current = divisionThresholds[currentIndex];
    if (current.isTopRank) {
      return {
        rankName: current.rankName,
        divisionName: null,
        currentMmr: mmr,
        divisionStartMmr: current.startMmr,
        nextDivisionName: null,
        nextDivisionMmr: null,
        mmrRemainingToNextDivision: null,
        nextRankName: null,
        nextRankMmr: null,
        mmrRemainingToNextRank: null,
        progressPercent: 100,
        isTopRank: true,
      };
    }

    const nextDivision = divisionThresholds[currentIndex + 1] || null;
    const nextRank = thresholds[current.rankIndex + 1] || null;
    const nextRankMmr = nextRank
      ? (Array.isArray(nextRank.divisions) ? nextRank.divisions[0] : nextRank.mmr)
      : null;
    const divisionProgress = nextDivision
      ? ((mmr - current.startMmr) / (nextDivision.startMmr - current.startMmr)) * 100
      : 100;

    return {
      rankName: current.rankName,
      divisionName: current.divisionName,
      currentMmr: mmr,
      divisionStartMmr: current.startMmr,
      nextDivisionName: nextDivision
        ? (nextDivision.rankIndex === current.rankIndex
          ? `Division ${nextDivision.divisionName}`
          : nextDivision.rankName)
        : null,
      nextDivisionMmr: nextDivision ? nextDivision.startMmr : null,
      mmrRemainingToNextDivision: nextDivision
        ? Math.max(0, nextDivision.startMmr - mmr)
        : null,
      nextRankName: nextRank ? nextRank.rank : null,
      nextRankMmr,
      mmrRemainingToNextRank: nextRankMmr === null
        ? null
        : Math.max(0, nextRankMmr - mmr),
      progressPercent: Math.min(100, Math.max(0, divisionProgress)),
      isTopRank: false,
    };
  }

  const api = { calculateRankProgress };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    window.RLRankProgress = api;
  }
})();
