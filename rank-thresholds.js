(function exposeRankThresholds() {
  const thresholds = Object.freeze([
    Object.freeze({ rank: "Bronze I", divisions: Object.freeze([-100, 120, 144, 157]) }),
    Object.freeze({ rank: "Bronze II", divisions: Object.freeze([170, 180, 199, 217]) }),
    Object.freeze({ rank: "Bronze III", divisions: Object.freeze([229, 240, 258, 277]) }),
    Object.freeze({ rank: "Silver I", divisions: Object.freeze([295, 299, 318, 337]) }),
    Object.freeze({ rank: "Silver II", divisions: Object.freeze([353, 359, 378, 397]) }),
    Object.freeze({ rank: "Silver III", divisions: Object.freeze([413, 419, 438, 457]) }),
    Object.freeze({ rank: "Gold I", divisions: Object.freeze([472, 479, 498, 517]) }),
    Object.freeze({ rank: "Gold II", divisions: Object.freeze([533, 539, 558, 577]) }),
    Object.freeze({ rank: "Gold III", divisions: Object.freeze([594, 599, 618, 637]) }),
    Object.freeze({ rank: "Platinum I", divisions: Object.freeze([646, 659, 678, 697]) }),
    Object.freeze({ rank: "Platinum II", divisions: Object.freeze([712, 719, 738, 757]) }),
    Object.freeze({ rank: "Platinum III", divisions: Object.freeze([773, 779, 798, 817]) }),
    Object.freeze({ rank: "Diamond I", divisions: Object.freeze([835, 844, 868, 892]) }),
    Object.freeze({ rank: "Diamond II", divisions: Object.freeze([915, 924, 948, 972]) }),
    Object.freeze({ rank: "Diamond III", divisions: Object.freeze([995, 1004, 1028, 1052]) }),
    Object.freeze({ rank: "Champion I", divisions: Object.freeze([1075, 1095, 1128, 1162]) }),
    Object.freeze({ rank: "Champion II", divisions: Object.freeze([1195, 1214, 1248, 1282]) }),
    Object.freeze({ rank: "Champion III", divisions: Object.freeze([1315, 1335, 1371, 1402]) }),
    Object.freeze({ rank: "Grand Champion I", divisions: Object.freeze([1435, 1462, 1498, 1537]) }),
    Object.freeze({ rank: "Grand Champion II", divisions: Object.freeze([1575, 1602, 1645, 1677]) }),
    Object.freeze({ rank: "Grand Champion III", divisions: Object.freeze([1715, 1744, 1788, 1832]) }),
    Object.freeze({ rank: "Supersonic Legend", mmr: 1861 }),
  ]);

  if (typeof module === "object" && module.exports) {
    module.exports = thresholds;
  } else {
    window.RLRankThresholds = thresholds;
  }
})();
