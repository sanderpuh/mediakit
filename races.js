/* ============================================================
   SANDERPUH — RACE LOG DATA
   One line per race. The site builds the table, year chips,
   and the summary line from this file automatically.
   Only podium finishes (1st/2nd/3rd) and TQ entries belong here.

   date:   "YYYY-MM-DD"
   event:  race name (city appended after ·)
   country: 2-letter code shown next to the event
   result: any number — the site only shows/counts 1, 2 and 3
           (use null if you didn't podium, e.g. TQ-only entry)
   tq:     true if you took Top Qualifier (TQ) that race

   Order: oldest at the top, newest at the bottom.
   ============================================================ */
const RACES = [
  // ----- 2023 -----
  { date: "2023-12-09", event: "DDR Santas Fun Run",                 country: "NL", result: 2,    tq: false },
  // ----- 2024 -----
  { date: "2024-01-06", event: "DDR New Years Race",                 country: "NL", result: null,    tq: true },
  { date: "2024-04-06", event: "DDR LEDs Spring",                    country: "NL", result: 2,    tq: false },
  { date: "2024-04-20", event: "DDR The Last PropBender",            country: "NL", result: 2,    tq: false },
  { date: "2024-05-18", event: "Race der Lage Landen",               country: "NL", result: 2,    tq: false },
  { date: "2024-08-31", event: "Race der Lage Landen Spec League",   country: "NL", result: 3,    tq: true },
  { date: "2024-10-13", event: "RaceGOW3 Track 2 - Tier 9",          country: "NL", result: 1,    tq: false },
  { date: "2024-11-10", event: "RaceGOW3 Track 4 - Tier 7",          country: "NL", result: 2,    tq: false },
  { date: "2024-11-23", event: "DDR Fall Frenzy",                    country: "NL", result: 2,    tq: false },
  { date: "2024-11-24", event: "RaceGOW3 Track 5 - Tier 3",          country: "NL", result: 3,    tq: false },
  // ----- 2025 -----
  { date: "2025-01-11", event: "DDR New Years Nitro",                country: "NL", result: 2,    tq: false },
  { date: "2025-02-22", event: "DDR Arabian Flights",                country: "NL", result: 3,    tq: false },
  { date: "2025-06-28", event: "BTMC Spec Race",                     country: "BE", result: 1,    tq: true },
  { date: "2025-10-04", event: "Belgian Navy Spec Race",             country: "BE", result: 1,    tq: true },
  { date: "2025-11-08", event: "Unmanned Valley DIY DAY",            country: "NL", result: 2,    tq: false },
  { date: "2025-11-09", event: "RaceGOW5 Track 2 - Tier 7",          country: "NL", result: 1,    tq: false },
  { date: "2025-11-29", event: "DDR Neon Nights",                    country: "NL", result: 2,    tq: false },
  { date: "2025-12-07", event: "RaceGOW5 Track 4 - Tier 9",          country: "NL", result: 1,    tq: false },
  { date: "2025-12-13", event: "DDR Jingle Whoops",                  country: "NL", result: 3,    tq: true },
  // ----- 2026 -----
  { date: "2026-01-04", event: "RaceGOW 5 Track 6 - Tier 6",         country: "NL", result: 1,    tq: false },
  { date: "2026-03-14", event: "DDR Whoop Awakening",                country: "NL", result: 3,    tq: false },
  { date: "2026-06-13", event: "Belgian Champs F9U Heat 4 Pampa",    country: "BE", result: 3,    tq: false },
  { date: "2026-09-05", event: "NK Drone Racing Finals",             country: "NL", result: 2,    tq: false },
  { date: "2026-09-06", event: "NK Drone Racing 2026 Season",        country: "NL", result: 3,    tq: false },
];
