// Whoop Ranking - competition configuration
//
// The ranking page shows every past race of one FPVScores competition,
// oldest first. Set the competition here; you can also switch between
// competitions with the dropdown on the page itself.
//
// The slug is the tail of the competition URL, e.g.
// https://fpvscores.com/competitions/ddr-whoop-league  ->  "ddr-whoop-league"
//
// Competitions with more than 8 races are hidden from the dropdown.
//
// Total = sum of the SCORED_RACES lowest race scores (see ranking.js).

const COMPETITION = "ddr-whoop-league";

// Competitions hidden from the dropdown, by slug (the URL tail) or by name.
const BLACKLIST = [
    "multigp-global-qualifiers-2026",
    "fai-wdc-2026",
];
