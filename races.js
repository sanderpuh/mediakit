/* ============================================================
   SANDERPUH — RACE LOG DATA
   One line per race. The site builds the table, year chips,
   and the summary line from this file automatically.
   Only podium finishes (1st/2nd/3rd) and TQ entries belong here.

   date:   "YYYY-MM-DD"
   event:  race name (city appended after ·)
   country: 2-letter code shown next to the event
   result: 1, 2, 3  — or null if you didn't podium (TQ-only entry)
   tq:     true if you took Top Qualifier (TQ) that race
   ============================================================ */
const RACES = [
  // ----- 2026 -----
  { date: "2026-08-22", event: "DCL · Berlin Night Circuit",  country: "DE", result: 1,    tq: false },
  { date: "2026-07-19", event: "DCL · Osaka Skyline",         country: "JP", result: 2,    tq: false },
  { date: "2026-06-14", event: "FAI F9U World Cup · Madrid",  country: "ES", result: 3,    tq: false },
  { date: "2026-05-03", event: "MultiGP Qualifier · Austin",  country: "US", result: null, tq: true  },
  // ----- 2025 -----
  { date: "2025-11-08", event: "FAI F9U World Cup Final · Cairo", country: "EG", result: 2, tq: false },
  { date: "2025-09-21", event: "DCL · Barcelona",             country: "ES", result: 1,    tq: false },
  { date: "2025-08-10", event: "National Series Rd 4 · Eindhoven", country: "NL", result: 2, tq: true },
  { date: "2025-06-28", event: "FAI World Cup Qualifier · Seoul", country: "KR", result: null, tq: true },
  { date: "2025-04-13", event: "DCL · Dubai",                 country: "AE", result: 1,    tq: false },
  // ----- 2024 -----
  { date: "2024-10-19", event: "MultiGP International · Las Vegas", country: "US", result: 3, tq: false },
  { date: "2024-08-04", event: "National Series Rd 6 · Lille", country: "FR", result: 1,   tq: false },
  { date: "2024-05-25", event: "FAI F9U Open · Vienna",       country: "AT", result: null, tq: true  },
  { date: "2024-03-17", event: "DCL · Miami",                 country: "US", result: 2,    tq: false },
  // ----- 2023 -----
  { date: "2023-09-09", event: "National Championship",       country: "NL", result: 3,    tq: false },
  { date: "2023-06-24", event: "Euro GQ · Prague",            country: "CZ", result: 1,    tq: true  },
  // ----- 2022 -----
  { date: "2022-10-15", event: "National Series Rd 8",        country: "NL", result: 1,    tq: false },
  // ----- 2021 -----
  { date: "2021-08-21", event: "National Series Rd 5",        country: "NL", result: 2,    tq: false },
  // ----- 2020 -----
  { date: "2020-09-12", event: "National Series Rd 3",        country: "NL", result: 3,    tq: false },
];
