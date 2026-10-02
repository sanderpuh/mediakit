#!/usr/bin/env node
// update-data.mjs - exports FPVScores race data to static JSON for GitHub Pages.
// Called by .github/workflows/update-data.yml. Zero dependencies: Node 20+.
//
// Env:
//   COMPETITIONS  comma-separated competition slugs (optional: overrides discovery)
//   BLACKLIST     comma-separated slugs to skip (optional: extends DEFAULT_BLACKLIST)
//   OUT_DIR       output folder for the JSON files (default 'data')
//   FULL_SCRAPE   set to '1' to re-fetch every event, ignoring freshness
//
// Output: one file per competition, data/<slug>.json, shaped so the ranking
// page can consume it directly. Every object carries its source URL so all
// links to fpvscores.com survive the copy.

import { mkdir, writeFile, readFile } from 'node:fs/promises';

const BASE = 'https://fpvscores.com';
const OUT_DIR = process.env.OUT_DIR || 'data';
// Competitions never to export or rank: big one-off events, etc.
const DEFAULT_BLACKLIST = ['fai-wdc-2026', 'multigp-global-qualifiers-2026'];
const BLACKLIST = [...DEFAULT_BLACKLIST,
  ...(process.env.BLACKLIST || '').split(',').map(s => s.trim()).filter(Boolean)];
// If COMPETITIONS is set, export exactly those; otherwise discover all
// competitions listed on fpvscores.com/competitions and drop blacklisted ones.
const COMPETITIONS = (process.env.COMPETITIONS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const UA = 'SanderPuh-ranking-export/1.0 (+https://github.com/)  personal non-commercial use';
const PAUSE_MS = 1500; // polite delay between requests to fpvscores.com

// Incremental updates: an event already present in the existing JSON is only
// re-fetched when it is upcoming (results may appear any moment) or less than
// a week old (results may still be corrected). Anything older and finished is
// frozen at what is on disk. Set FULL_SCRAPE=1 to bypass this and fetch all.
const FULL_SCRAPE = process.env.FULL_SCRAPE === '1';
const REFETCH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadExisting(slug) {
  try {
    const raw = JSON.parse(await readFile(`${OUT_DIR}/${slug}.json`, 'utf8'));
    return raw && Array.isArray(raw.events) ? raw : null;
  } catch {
    return null;
  }
}

// Map an existing event to the freshly discovered one. Manual events (no uid)
// never match and are always merged again below.
function findExisting(events, uid) {
  return events.find(e => e.uid === uid && e.ok !== false) || null;
}

function needsRefetch(existing, discovered) {
  if (FULL_SCRAPE) return true;
  if (discovered.upcoming) return true;                 // race may have just run
  if (!existing || !existing.ok || !existing.pilots.length) return true;
  if (existing.date) {
    const age = Date.now() - Date.parse(existing.date + 'T00:00:00Z');
    if (age < REFETCH_DAYS * DAY_MS) return true;       // recently finished
  }
  return false;                                          // old and finished: keep cached
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// --- tiny HTML helpers ------------------------------------------------------

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}
const clean = s => decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

// Extract pilots from the results page HTML. Row markup (verified against
// fpvscores.com):
//   <tr>
//     <td class="results-pos results-pos--1">1</td>
//     <td><span class="result-pilot"> <img class="pilot-avatar" ...>
//       <span class="result-pilot__text">
//         <span class="result-pilot__name">
//           <a href="/events/<uid>/results/<slug>">CALLSIGN</a>
//           <img class="flag-img" src="https://flagcdn.com/40x30/be.webp" ...>
//         </span>
//         <small>Real Name</small>
//       </span></span></td>
//     ...lap/time cells...
//   </tr>
// Big (link) name = callsign, <small> = real name. Rows without a link have
// no <small> either - the visible name is the real name then.
function parseResults(html) {
  const pilots = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    if (!/results-pos/.test(row) || !/result-pilot/.test(row)) continue;
    const posM = row.match(/results-pos[^>]*>\s*([\d.]+)/);
    const pos = posM ? Math.round(parseFloat(posM[1])) : NaN;
    if (isNaN(pos)) continue;
    const linkM = row.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const href = linkM ? linkM[1] : null;
    const cs = linkM ? clean(linkM[2]) : null;
    const slug = href ? decodeURIComponent(href.split('/').pop()) : null;
    const smallM = row.match(/<small[^>]*>([\s\S]*?)<\/small>/);
    const flagM = row.match(/<img[^>]*flag-img[^>]*src="([^"]*)"/);
    // stable key = real name when present, else the callsign
    const name = smallM ? clean(smallM[1]) : cs;
    if (!name) continue;
    pilots.push({
      name, cs: cs || '', pos,
      flag: flagM ? flagM[1] : null,
      slug,
      // pilot profile link: per-entry slugs are /u/ usernames only when they
      // are not pilot-NNNNN (those are event-scoped entry ids, not accounts)
      url: slug && !/^pilot-\d+$/.test(slug) ? BASE + '/u/' + slug : null
    });
  }
  return pilots;
}

// Parse the competition's event list page: /competitions/<slug>.
// Markup (same as the browser parser): <a class="event-row" href="/events/<uid>">
//   <span class="event-row__title">TITLE</span> ... text contains "9 Mar 2026".
// Dates are parsed to ISO and events are sorted oldest first, so Race 1..N
// matches what the ranking page shows. Upcoming events get "upcoming": true.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseEvents(html) {
  const events = [];
  const re = /<a[^>]*class="[^"]*event-row[^"]*"[^>]*href="(\/events\/([A-Za-z0-9]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const uid = m[2];
    if (seen.has(uid)) continue;
    seen.add(uid);
    const block = m[3];
    const tm = block.match(/event-row__title[^>]*>([\s\S]*?)<\/span>/);
    const title = clean(tm ? tm[1] : block) || uid;
    const dm = block.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    let date = null;
    if (dm && MONTHS[dm[2]] !== undefined) {
      date = new Date(Date.UTC(+dm[3], MONTHS[dm[2]], +dm[1])).toISOString().slice(0, 10);
    }
    const upcoming = date ? date >= new Date().toISOString().slice(0, 10) : false;
    events.push({ uid, title, date, upcoming, url: BASE + '/events/' + uid });
  }
  return events.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}

// Discover every competition listed on fpvscores.com/competitions.
// Card markup: <div class="comp-card" ...><h3>Name</h3><div class="comp-card__meta">.. 12 events ..</div>
// with the whole card linking to /competitions/<slug>.
async function discoverCompetitions() {
  const html = await fetchText(BASE + "/competitions/");
  const out = [];
  const seen = new Set();
  const cardRe = /<a[^>]*href="\/competitions\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    const slug = m[1];
    if (slug === "logo" || slug === "card" || seen.has(slug)) continue;
    seen.add(slug);
    const block = m[2];
    const nm = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const name = nm ? clean(nm[1]) : slug;
    out.push({ slug, name });
  }
  return out;
}

// Manual events: races that exist offline but not on FPVScores (e.g. a
// championship final). They live in data/manual-events.json (a single file,
// keyed by competition slug) so you can add them without touching the script;
// the next run merges them into the exported JSON automatically. Pilots MUST
// already exist in the scraped data (matched by callsign, case-insensitive);
// unknown callsigns are a hard error so nothing new can slip in. Fields per
// pilot: cs (required, must match a scraped pilot) and pos. name, flag, slug
// and url are copied from the matched pilot; fieldSize is set to the pilot
// count. Set date to null when unknown: it sorts after any dated event. Set
// "final": true on a championship final: the website scores it with a 1.2x
// points multiplier.
//
// Example data/manual-events.json:
// {
//   "dutch-nationals": [
//     { "uid": "nk-drone-racing-2026-finals",
//       "title": "NK Drone Racing 2026 - Finals",
//       "date": null, "url": null, "final": false,
//       "pilots": [
//         { "cs": "Keepy", "pos": 1 },
//         { "cs": "SanderPuh", "pos": 2 }
//       ] }
//   ]
// }
const MANUAL_EVENTS_FILE = `${OUT_DIR}/manual-events.json`;

// Merge manual events for slug into the scraped events, validating every
// pilot against the union of scraped pilot callsigns.
async function mergeManualEvents(slug, events) {
  let manual = [];
  try {
    const all = JSON.parse(await readFile(MANUAL_EVENTS_FILE, 'utf8'));
    manual = all[slug] || [];
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return events; // no manual-events file: nothing to merge
  }
  const known = new Map();
  for (const ev of events) {
    for (const p of ev.pilots) known.set(p.cs.toLowerCase(), p);
  }
  for (const me of manual) {
    const pilots = me.pilots.map((mp) => {
      const match = known.get(mp.cs.toLowerCase());
      if (!match) throw new Error(`manual event "${me.title}": callsign "${mp.cs}" not found in scraped pilots of ${slug}`);
      return { name: match.name, cs: match.cs, pos: mp.pos, flag: match.flag, slug: match.slug, url: match.url, fieldSize: me.pilots.length };
    });
    events.push({
      uid: me.uid,
      title: me.title,
      date: me.date || null,
      upcoming: false,
      url: me.url || null,
      final: me.final === true,
      ok: true,
      pilots,
    });
    console.log(`  merged manual event: ${me.title} (${pilots.length} pilots)`);
  }
  return events;
}

// --- main -------------------------------------------------------------------

async function exportCompetition(slug) {
  const compUrl = `${BASE}/competitions/${slug}`;
  const compHtml = await fetchText(compUrl);
  const events = parseEvents(compHtml);
  if (!events.length) throw new Error(`No events found for ${slug}`);
  console.log(`${slug}: ${events.length} events`);

  const existingData = await loadExisting(slug);
  const existingEvents = existingData ? existingData.events : [];
  const exported = [];
  for (const ev of events) {
    const prior = findExisting(existingEvents, ev.uid);
    const resultsUrl = `${BASE}/events/${ev.uid}/ranking`;
    // A 404 here means the ranking is not published yet — the race hasn't
    // run. No fallback needed.
    if (prior && !needsRefetch(prior, ev)) {
      console.log(`  ${ev.uid}: cached (finished ${prior.date})`);
      exported.push({ ...ev, url: prior.url || resultsUrl, date: prior.date || ev.date, upcoming: ev.upcoming, ok: true, pilots: prior.pilots });
      continue;
    }
    let html;
    let fetchedUrl = resultsUrl;
    try {
      html = await fetchText(resultsUrl);
    } catch (e) {
      // Not published yet (race hasn't run) or network failure: fall back
      // to the cached copy if we have one.
      if (prior) {
        console.warn(`  ${ev.uid}: fetch failed, kept cached copy`);
        exported.push({ ...ev, url: prior.url || resultsUrl, date: prior.date || ev.date, upcoming: ev.upcoming, ok: true, pilots: prior.pilots });
        continue;
      }
      console.warn(`  skip ${ev.uid}: ${e.message}`);
      exported.push({ ...ev, url: resultsUrl, ok: false, pilots: [] });
      continue;
    }
    const pilots = parseResults(html);
    if (!pilots.length && prior && prior.pilots.length) {
      // Empty results page but we have data: keep the cached copy.
      console.log(`  ${ev.uid}: empty results page, kept cached copy`);
      exported.push({ ...ev, url: prior.url || resultsUrl, date: prior.date || ev.date, upcoming: ev.upcoming, ok: true, pilots: prior.pilots });
      continue;
    }
    const total = pilots.length;
    // No points stored in the JSON: the website calculates them from pos
    // (DDR: top 16 get 16..1, below that 1; PDRNL: pos*100/fieldSize).
    // fieldSize is kept so PDRNL can be recomputed client-side.
    pilots.forEach(p => { p.fieldSize = total; });
    exported.push({
      ...ev,
      url: fetchedUrl,
      date: ev.date,
      upcoming: ev.upcoming,
      ok: total > 0,
      pilots
    });
    console.log(`  ${ev.uid}: ${total} pilots`);
    await sleep(PAUSE_MS);
  }

  return {
    competition: slug,
    generatedAt: new Date().toISOString(),
    source: compUrl,
    events: exported
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let slugs = COMPETITIONS;
  if (!slugs.length) {
    slugs = (await discoverCompetitions()).filter(c => !BLACKLIST.includes(c.slug));
    if (!slugs.length) { console.error('No competitions discovered on ' + BASE + '/competitions'); process.exit(1); }
    console.log(`discovered ${slugs.length} competitions (blacklist: ${BLACKLIST.join(', ')})`);
  }
  let failed = 0;
  const index = [];
  for (const comp of slugs) {
    const slug = typeof comp === 'string' ? comp : comp.slug;
    const name = typeof comp === 'string' ? slug : (comp.name || slug);
    try {
      const data = await exportCompetition(slug);
      await mergeManualEvents(slug, data.events);
      const file = `${OUT_DIR}/${slug}.json`;
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
      index.push({ slug, name, events: data.events.length });
      console.log(`wrote ${file}`);
    } catch (e) {
      console.error(`FAILED ${slug}: ${e.message}`);
      failed++;
    }
    await sleep(PAUSE_MS);
  }
  // index.json lists every exported competition: the ranking page uses it to
  // fill the dropdown (manual-events.json is not listed and never served).
  await writeFile(`${OUT_DIR}/index.json`, JSON.stringify(index, null, 2) + '\n');
  console.log(`wrote ${OUT_DIR}/index.json`);
  if (failed) process.exit(1); // non-zero exit keeps the commit step from running on partial data
}

main();
