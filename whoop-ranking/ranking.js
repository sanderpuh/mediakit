// Whoop Ranking - fetches results from fpvscores.com and builds the table.
//
// The competition is chosen with the dropdown on the page (default from
// events.js: COMPETITION). All past and upcoming events of the competition
// become race columns, oldest first. Upcoming events count as 100 points for
// every pilot until their results exist.
//
// Everything is cached in localStorage, so a page reload reuses the scraped
// data. The Refresh button clears the cache and re-scrapes FPVScores.
//
// Points per event: (position * 100) / totalPilots - lower is better.
// Total score: the sum of the SCORED_RACES lowest points scores.
const SCORED_RACES = 3; // how many lowest scores count towards the total

// The browser can't call fpvscores.com directly (CORS), so requests go through
// a proxy that fetches the page server-side. X-Return-Format: html makes
// r.jina.ai return the raw page instead of extracted markdown.
const PROXIES = [
    (t) => "https://r.jina.ai/" + t
];

async function fetchPage(target) {
    let lastErr = null;
    for (const proxy of PROXIES) {
        try {
            const res = await fetch(proxy(target), {
                headers: { "X-Return-Format": "html" }
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            return new DOMParser().parseFromString(await res.text(), "text/html");
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
}

// --- localStorage cache -----------------------------------------------------
// wr:comps      -> { ts, list: [{slug,name,category,races}] }   competitions list
// wr:comp:slug  -> { ts, events: [{uid,title,date}], rankings: {uid: parsed} }
// wr:sel        -> last selected competition slug
const COMP_TTL = 12 * 60 * 60 * 1000; // competitions list re-fetch after 12h

function cacheGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function cacheSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
function cacheDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
const compKey = (slug) => "wr:comp:" + slug;

function parseResults(doc) {    // Use the first populated results table (the page's default class view).
    let table = null;
    for (const t of doc.querySelectorAll("table.results-table")) {
        if (t.querySelector("tbody tr")) { table = t; break; }
    }
    if (!table) return { pilots: [], title: pageTitle(doc) };

    const pilots = [];
    let total = 0;
    table.querySelectorAll("tbody tr").forEach((tr) => {
        const posEl = tr.querySelector(".results-pos");
        const linkEl = tr.querySelector(".result-pilot__name a");
        if (!posEl) return;
        // 'small' name = the pilot's real name, used as the stable key and
        // shown in the ranking table.
        const smallEl = tr.querySelector(".result-pilot small");
        const name = (smallEl ? smallEl.textContent : (linkEl ? linkEl : tr.querySelector(".result-pilot__name")).textContent).trim();
        const pos = parseInt(posEl.textContent.trim(), 10);
        if (isNaN(pos) || !name) return;
        pilots.push({
            name: name,
            // national flag image (flagcdn URL), may be null
            flag: (tr.querySelector(".result-pilot__name img.flag-img") || {}).getAttribute ? tr.querySelector(".result-pilot__name img.flag-img").getAttribute("src") : null,
            pos: pos,
            // callsign (the big name on the row) - used to match against the
            // /results page when the row has no link
            cs: ((linkEl || tr.querySelector(".result-pilot__name strong") || tr.querySelector(".result-pilot__name")).textContent || "").trim(),
            // pilot profile link: the per-entry slug is also the /u/ username,
            // e.g. /events/1Rm0iap4Um/results/reefpv -> https://fpvscores.com/u/reefpv
            // some rows have no link at all (no FPVScores account) -> slug stays null;
            // those get an event entry id (pilot-NNNNN) from the /results page below
            slug: linkEl && linkEl.getAttribute("href") ? linkEl.getAttribute("href").split("/").pop() : null
        });
        total++;
    });
    // Points: (position * 100) / total pilots - lower is better
    pilots.forEach((p) => { p.points = (p.pos * 100) / (total || 1); });
    return { pilots: pilots, title: pageTitle(doc) };
}

// Some pilots have no FPVScores account, so their /ranking row has no link -
// but the /results page gives every pilot a per-event entry id (pilot-NNNNN).
// Build a lookup by real name and callsign so we can link their scores too.
// These ids are event-scoped, NOT usernames, so they're not used for /u/ links.
async function fetchSlugMap(uid) {
    const target = "https://fpvscores.com/events/" + uid + "/results";
    const doc = await fetchPage(target);
    const map = {};
    doc.querySelectorAll(".result-pilot").forEach((el) => {
        const a = el.querySelector(".result-pilot__name a");
        if (!a) return;
        const slug = (a.getAttribute("href") || "").split("/").pop();
        if (!slug) return;
        const flag = el.querySelector("img.flag-img");
        const flagSrc = flag ? flag.getAttribute("src") : null;
        const small = el.querySelector("small");
        if (small) map[small.textContent.trim()] = slug;
        map[(a.textContent || "").trim()] = slug;
        if (flagSrc) {
            if (small) map["flag:" + small.textContent.trim()] = flagSrc;
            map["flag:" + (a.textContent || "").trim()] = flagSrc;
        }
    });
    return map;
}

function pageTitle(doc) {
    const t = doc.querySelector("title");
    if (!t) return "";
    // "Ranking | NK Drone Racing 2026 - Ranking 3" -> "NK Drone Racing 2026 - Ranking 3"
    const parts = t.textContent.split("|");
    return (parts.length > 1 ? parts[1] : parts[0]).trim();
}

function buildTable(results) {
    const body = document.getElementById("ranking-body");

    // --- race header row ---
    const headRow = document.getElementById("race-header-row");
    // Remove only previously generated race headers, keep the fixed cells.
    headRow.querySelectorAll("th.race-th").forEach((th) => th.remove());
    results.forEach((r, i) => {
        const th = document.createElement("th");
        th.className = "num race-th";
        if (r.ok) {
            const a = document.createElement("a");
            a.href = "https://fpvscores.com/events/" + r.uid + "/ranking";
            a.target = "_blank";
            a.rel = "noopener";
            a.title = r.title || "Race on FPVScores";
            a.textContent = "Race " + (i + 1);
            th.appendChild(a);
        } else {
            th.textContent = "Race " + (i + 1);
            th.title = r.placeholder ? "Upcoming event - counts as 100 points" : "Not loaded - counts as 100 points";
        }
        headRow.appendChild(th);
    });

    // --- collect pilot scores keyed by real (small) name ---
    const pilots = new Map(); // name -> { name, slug, scores: [{points, raceIdx}] }
    results.forEach((r, i) => {
        r.pilots.forEach((p) => {
            if (!pilots.has(p.name)) pilots.set(p.name, { name: p.name, slug: null, slugIsUser: true, flag: null, cs: "", scores: [] });
            const entry = pilots.get(p.name);
            if (!entry.slug && p.slug) { entry.slug = p.slug; entry.slugIsUser = p.slugIsUser !== false; }
            if (!entry.flag && p.flag) entry.flag = p.flag;
            if (!entry.cs && p.cs) entry.cs = p.cs;
            entry.scores.push({ points: p.points, raceIdx: i, slug: p.slug });
        });
    });

    // --- missing entries: every pilot not listed in a loaded event scores
    //     100 points (last place) for that race ---
    results.forEach((r, i) => {
        if (!r.ok) return; // failed fetches keep a dash
        for (const entry of pilots.values()) {
            if (!entry.scores.some((s) => s.raceIdx === i)) {
                entry.scores.push({ points: 100, raceIdx: i, missed: true });
            }
        }
    });

    // --- totals ---
    // Total = the sum of the SCORED_RACES lowest race scores.
    const entries = [...pilots.values()].map((p) => {
        const sorted = [...p.scores].sort((a, b) => a.points - b.points);
        const counted = sorted.slice(0, SCORED_RACES);
        return {
            name: p.name,
            slug: p.slug,
            slugIsUser: p.slugIsUser,
            flag: p.flag,
            cs: p.cs,
            scores: p.scores,
            countedSet: new Set(counted),
            total: counted.reduce((s, c) => s + c.points, 0)
        };
    });

    entries.sort((a, b) => a.total - b.total);

    // --- render rows ---
    body.innerHTML = "";
    entries.forEach((entry, idx) => {
        const tr = document.createElement("tr");

        const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);

        const posClass = idx === 0 ? "pos r-1" : idx === 1 ? "pos r-2" : idx === 2 ? "pos r-3" : "pos other";
        let html = '<td class="rank-cell"><span class="' + posClass + '">' + (idx + 1) + "</span></td>";

        const nameHtml = entry.slug && entry.slugIsUser
            ? '<a href="https://fpvscores.com/u/' + encodeURIComponent(entry.slug) + '" target="_blank" rel="noopener">' + escapeHtml(entry.name) + "</a>"
            : escapeHtml(entry.name);
        const subHtml = entry.cs && entry.cs !== entry.name
            ? '<span class="pilot-sub">' + escapeHtml(entry.cs) + "</span>"
            : "";
        html += '<td class="pilot">' + nameHtml + (entry.flag ? ' <img class="flag-img" src="' + escapeHtml(entry.flag) + '" alt="" width="16" height="12" loading="lazy">' : "") + subHtml + "</td>";
        html += '<td class="num">' + fmt(entry.total) + "</td>";
        html += '<td class="sep"></td>';

        results.forEach((r, rIdx) => {
            const s = entry.scores.find((sc) => sc.raceIdx === rIdx);
            if (s && s.missed) {
                html += '<td class="num missed" title="No entry on FPVScores - counts as 100">100</td>';
            } else if (s) {
                const dropped = !entry.countedSet.has(s);
                const scoreTxt = fmt(s.points);
                const title = (dropped ? "Dropped score" : "");
                if (s.slug) {
                    const href = "https://fpvscores.com/events/" + r.uid + "/results/" + encodeURIComponent(s.slug);
                    html += '<td class="num' + (dropped ? " dropped" : "") + '"><a href="' + href + '" target="_blank" rel="noopener"' +
                        (title ? ' title="' + title + '"' : '') + ">" + scoreTxt + "</a></td>";
                } else {
                    html += '<td class="num' + (dropped ? " dropped" : "") + '"' +
                        (title ? ' title="' + title + '"' : '') + ">" + scoreTxt + "</td>";
                }
            } else {
                html += '<td class="num missed">–</td>';
            }
        });
        tr.innerHTML = html;
        body.appendChild(tr);
    });

    const status = document.getElementById("status");
    const failed = results.filter((r) => !r.ok);
    const loaded = results.length - failed.length;
    let msg = loaded + " event" + (loaded === 1 ? "" : "s") + " loaded. Total = sum of the " +
        SCORED_RACES + " lowest race scores.";
    if (failed.length) {
        msg += " Could not load: " + failed.map((r) => r.uid).join(", ");
    }
    status.textContent = msg;
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- competition page parsing ----------------------------------------------
// /competitions/ card: <a href="/competitions/slug"> <h3>Name</h3> ...
// <span>5 events</span> ...
function parseCompetitions(doc) {
    const list = [];
    doc.querySelectorAll("a[href^='/competitions/'], a[href^=\"https://fpvscores.com/competitions/\"]").forEach((a) => {
        const href = a.getAttribute("href");
        const slug = href.replace(/^.*\/competitions\//, "").replace(/\/$/, "");
        if (!slug || slug === "logo") return;
        const card = a.closest("[data-comp-card]") || a;
        const meta = card.querySelector(".comp-card__meta");
        if (!meta) return;
        let races = Infinity;
        const m = (meta.textContent.match(/(\d+)\s+events?/) || []);
        if (m[1]) races = parseInt(m[1], 10);
        const name = (card.querySelector("h3") || {}).textContent || slug;
        const bl = (typeof BLACKLIST !== "undefined") ? BLACKLIST : [];
        if (bl.some((b) => slug === b || name.trim().toLowerCase() === String(b).toLowerCase())) return;
        list.push({ slug: slug, name: name.trim(), races: races });
    });
    // de-dupe by slug, keep order
    const seen = new Set();
    return list.filter((c) => !seen.has(c.slug) && seen.add(c.slug));
}

// Competition page: .event-row anchors in the past and upcoming lists.
// Each holds the event uid, title and a date like "14 Nov 2026".
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseCompEvents(doc) {
    const events = [];
    doc.querySelectorAll("a.event-row").forEach((a) => {
        const m = (a.getAttribute("href") || "").match(/\/events\/([A-Za-z0-9]+)/);
        if (!m) return;
        const title = (a.querySelector(".event-row__title") || a).textContent.trim().replace(/\s+/g, " ");
        const dm = a.textContent.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
        let date = null;
        if (dm && MONTHS[dm[2]] !== undefined) {
            date = new Date(Date.UTC(+dm[3], MONTHS[dm[2]], +dm[1])).toISOString().slice(0, 10);
        }
        events.push({ uid: m[1], title: title, date: date });
    });
    // oldest first; events without a date go last, keeping page order
    return events.sort((a, b) => {
        if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
        if (a.date) return -1;
        if (b.date) return 1;
        return 0;
    });
}

async function getCompetitions() {
    let cached = cacheGet("wr:comps");
    if (cached && Date.now() - cached.ts < COMP_TTL && cached.list.length) return cached.list;
    const doc = await fetchPage("https://fpvscores.com/competitions/");
    const list = parseCompetitions(doc);
    if (list.length) cacheSet("wr:comps", { ts: Date.now(), list: list });
    return list.length ? list : (cached ? cached.list : []);
}

// Load one competition: events list + per-event rankings, via cache when
// available. force=true (Refresh button) ignores the cache entirely.
async function loadCompetition(slug, force) {
    const status = document.getElementById("status");
    let cache = force ? null : cacheGet(compKey(slug));
    if (!cache) cache = { ts: 0, events: [], rankings: {} };

    let events = cache.events;
    if (!events.length || force) {
        status.textContent = "Loading competition " + slug + "…";
        try {
            events = parseCompEvents(await fetchPage("https://fpvscores.com/competitions/" + slug));
        } catch (e) {
            if (!events.length) throw e; // nothing cached either -> give up
            events = cache.events; // fall back to cached event list
        }
    }
    if (!events.length) throw new Error("no events found for " + slug);

    const results = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const ev of events) {
        const cachedRank = cache.rankings && cache.rankings[ev.uid];
        const isPast = !ev.date || ev.date <= today; // no date -> treat as past
        if (cachedRank && !force) {
            results.push(cachedRank);
            continue;
        }
        if (!isPast) {
            // Upcoming event: no results yet -> 100 points for everyone.
            results.push({ uid: ev.uid, title: ev.title, pilots: [], ok: true, placeholder: true });
            continue;
        }
        status.textContent = "Loading event " + ev.title + "…";
        try {
            const parsed = parseResults(await fetchPage("https://fpvscores.com/events/" + ev.uid + "/ranking"));
            if (!parsed.pilots.length) throw new Error("no results found");
            // Fill in entry ids for pilots without a /ranking link: match them
            // against the /results page by real name, then callsign.
            if (parsed.pilots.some((p) => !p.slug)) {
                try {
                    const map = await fetchSlugMap(ev.uid);
                    parsed.pilots.forEach((p) => {
                        if (!p.slug) {
                            p.slug = map[p.name] || map[p.cs] || null;
                            if (p.slug) p.slugIsUser = false;
                            if (!p.flag) p.flag = map["flag:" + p.name] || map["flag:" + p.cs] || null;
                        }
                    });
                } catch (e) { console.error("Slug map failed for " + ev.uid, e); }
            }
            const stored = { uid: ev.uid, title: parsed.title || ev.title, pilots: parsed.pilots, ok: true };
            cache.rankings[ev.uid] = stored;
            results.push(stored);
        } catch (e) {
            console.error("Failed to load " + ev.uid, e);
            results.push({ uid: ev.uid, title: ev.title, pilots: [], ok: false });
        }
    }

    cache.ts = Date.now();
    cache.events = events;
    cacheSet(compKey(slug), cache);
    return { events: events, results: results };
}

function setupControls() {
    const select = document.getElementById("comp-select");
    const btn = document.getElementById("refresh-btn");
    const status = document.getElementById("status");

    btn.addEventListener("click", async () => {
        const slug = select.value;
        if (!slug) return;
        cacheDel(compKey(slug));
        cacheDel("wr:comps"); // also re-fetch the competition list (picks up blacklist changes)
        select.innerHTML = "";
        if (setupControlsCache) await setupControlsCache.fill();
    });

    select.addEventListener("change", () => {
        if (!select.value) return;
        cacheSet("wr:sel", select.value);
        run(false);
    });

    return {
        fill: async () => {
            status.textContent = "Loading competitions…";
            try {
                const comps = await getCompetitions();
                select.innerHTML = "";
                comps.forEach((c) => {
                    const o = document.createElement("option");
                    o.value = c.slug;
                    o.textContent = c.name + " (" + c.races + " races)";
                    select.appendChild(o);
                });
                const saved = cacheGet("wr:sel");
                const def = (saved && comps.some((c) => c.slug === saved)) ? saved
                          : (comps.some((c) => c.slug === COMPETITION) ? COMPETITION : null);
                if (def) select.value = def;
                return select.value;
            } catch (e) {
                console.error(e);
                status.textContent = "Could not load the competition list.";
                status.classList.add("err");
                return null;
            }
        },
        busy: (b) => { btn.disabled = b; select.disabled = b; }
    };
}

async function run(force) {
    const slug = document.getElementById("comp-select").value;
    if (!slug) return;
    const status = document.getElementById("status");
    document.getElementById("refresh-btn").disabled = true;
    status.classList.remove("err");
    try {
        const { results } = await loadCompetition(slug, force);
        buildTable(results);
        if (results.length && !results.some((r) => r.ok && !r.placeholder && r.pilots.length)) {
            status.textContent = "No race results for this competition yet.";
        }
    } catch (e) {
        console.error(e);
        status.textContent = "Could not load " + slug + ".";
        status.classList.add("err");
    }
    document.getElementById("refresh-btn").disabled = false;
}


(async function main() {
    const controls = await setupControls();
    setupControlsCache = controls;
    if (!controls) return; // no competitions -> nothing to do
    await controls.fill();
    await run(false);
})();
