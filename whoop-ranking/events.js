// Whoop Ranking — race configuration
//
// One entry per race column. The number of entries = number of race columns.
//
// - uid: the FPVScores event UID, taken from the results URL,
//   e.g. https://fpvscores.com/events/1Rm0iap4Um/results  ->  "1Rm0iap4Um"
// - If uid is "" (or missing), the race counts for every pilot as 100 points
//   (a placeholder race with no results to fetch).
//
// Total = sum of the SCORED_RACES lowest race scores (see ranking.js).

const RACES = [
    { uid: "4847rP2PKc" },
    { uid: "y8txSgByb0" },
    { uid: "1Rm0iap4Um" },
    { uid: "" },  // Race 4 — no UID yet: 100 points for everyone
];
