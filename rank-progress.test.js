const assert = require("node:assert/strict");
const test = require("node:test");
const { calculateRankProgress } = require("./rank-progress");
const thresholds = require("./rank-thresholds");

test("identifies each division from its starting threshold", () => {
  const cases = [
    [-100, "Bronze I", "I"],
    [120, "Bronze I", "II"],
    [170, "Bronze II", "I"],
    [835, "Diamond I", "I"],
    [1004, "Diamond III", "II"],
    [1075, "Champion I", "I"],
    [1435, "Grand Champion I", "I"],
    [1861, "Supersonic Legend", null],
  ];

  cases.forEach(([mmr, rankName, divisionName]) => {
    const progress = calculateRankProgress(mmr);
    assert.equal(progress.rankName, rankName, `rank at ${mmr} MMR`);
    assert.equal(progress.divisionName, divisionName, `division at ${mmr} MMR`);
  });
});

test("maps every supplied starting threshold to the rank and division it defines", () => {
  thresholds.forEach((rank) => {
    if (Array.isArray(rank.divisions)) {
      rank.divisions.forEach((mmr, index) => {
        const progress = calculateRankProgress(mmr);
        assert.equal(progress.rankName, rank.rank, `rank at ${mmr} MMR`);
        assert.equal(progress.divisionName, ["I", "II", "III", "IV"][index]);
      });
    } else {
      const progress = calculateRankProgress(rank.mmr);
      assert.equal(progress.rankName, rank.rank);
      assert.equal(progress.isTopRank, true);
    }
  });
});

test("calculates progress and remaining MMR within a division and toward the next rank", () => {
  const progress = calculateRankProgress(1016);

  assert.equal(progress.rankName, "Diamond III");
  assert.equal(progress.divisionName, "II");
  assert.equal(progress.nextDivisionName, "Division III");
  assert.equal(progress.nextDivisionMmr, 1028);
  assert.equal(progress.mmrRemainingToNextDivision, 12);
  assert.equal(progress.nextRankName, "Champion I");
  assert.equal(progress.nextRankMmr, 1075);
  assert.equal(progress.mmrRemainingToNextRank, 59);
  assert.equal(progress.progressPercent, 50);
});

test("uses the next rank threshold as the Division IV boundary", () => {
  const progress = calculateRankProgress(1052);

  assert.equal(progress.rankName, "Diamond III");
  assert.equal(progress.divisionName, "IV");
  assert.equal(progress.nextDivisionName, "Champion I");
  assert.equal(progress.mmrRemainingToNextDivision, 23);
  assert.equal(progress.nextRankName, "Champion I");
  assert.equal(progress.mmrRemainingToNextRank, 23);
  assert.equal(progress.progressPercent, 0);
});

test("exact division and rank thresholds start the new division at zero progress", () => {
  const divisionStart = calculateRankProgress(1028);
  assert.equal(divisionStart.rankName, "Diamond III");
  assert.equal(divisionStart.divisionName, "III");
  assert.equal(divisionStart.progressPercent, 0);
  assert.equal(divisionStart.mmrRemainingToNextDivision, 24);

  const rankStart = calculateRankProgress(1075);
  assert.equal(rankStart.rankName, "Champion I");
  assert.equal(rankStart.divisionName, "I");
  assert.equal(rankStart.progressPercent, 0);
  assert.equal(rankStart.mmrRemainingToNextRank, 120);
});

test("handles Supersonic Legend without division or next-rank estimates", () => {
  for (const mmr of [1861, 2000, 99999]) {
    const progress = calculateRankProgress(mmr);
    assert.equal(progress.rankName, "Supersonic Legend");
    assert.equal(progress.divisionName, null);
    assert.equal(progress.nextDivisionName, null);
    assert.equal(progress.nextRankName, null);
    assert.equal(progress.mmrRemainingToNextDivision, null);
    assert.equal(progress.mmrRemainingToNextRank, null);
    assert.equal(progress.progressPercent, 100);
    assert.equal(progress.isTopRank, true);
  }
});

test("returns no rank for missing, invalid, or out-of-range MMR", () => {
  for (const mmr of [null, undefined, "1300", NaN, Infinity, -101, 100000]) {
    assert.equal(calculateRankProgress(mmr), null);
  }
});

test("never returns negative MMR remaining values", () => {
  const progress = calculateRankProgress(1027.9);
  assert.ok(progress.mmrRemainingToNextDivision >= 0);
  assert.ok(progress.mmrRemainingToNextRank >= 0);
});
