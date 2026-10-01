// Whoop Ranking — fetches results from fpvscores.com and builds the table.
//
// Race configuration lives in events.js (RACES). Each entry may hold a UID or
// an empty string; an empty UID counts as a placeholder race worth 100 points
// for every pilot.
//
// Points per event: (position * 100) / totalPilots — lower is better.
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
            // callsign (the big name on the row) — used to match against the
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
    // Points: (position * 100) / total pilots — lower is better
    pilots.forEach((p) => { p.points = (p.pos * 100) / (total || 1); });
    return { pilots: pilots, title: pageTitle(doc) };
}

// Some pilots have no FPVScores account, so their /ranking row has no link —
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
    headRow.innerHTML =
        '<th class="rank-cell"></th><th></th><th class="num"></th><th class="sep"></th>';
    results.forEach((r, i) => {
        const th = document.createElement("th");
        th.className = "num";
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
            th.title = "No FPVScores UID set — counts as 100 points";
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
    RACES.forEach((race, i) => {
        if (!results[i].ok) return; // failed fetches keep a dash
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
        html += '<td class="pilot">' + nameHtml + subHtml + (entry.flag ? ' <img class="flag-img" src="' + escapeHtml(entry.flag) + '" alt="" width="16" height="12" loading="lazy">' : "") + "</td>";
        html += '<td class="num">' + fmt(entry.total) + "</td>";
        html += '<td class="sep"></td>';

        RACES.forEach((race, r) => {
            const s = entry.scores.find((sc) => sc.raceIdx === r);
            if (s && s.missed) {
                html += '<td class="num missed" title="No entry on FPVScores — counts as 100">100</td>';
            } else if (s) {
                const dropped = !entry.countedSet.has(s);
                const scoreTxt = fmt(s.points);
                const title = (dropped ? "Dropped score" : "");
                if (s.slug) {
                    const href = "https://fpvscores.com/events/" + results[r].uid + "/results/" + encodeURIComponent(s.slug);
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
        status.style.color = "#e07a5f";
    }
    status.textContent = msg;
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

(async function main() {
    const results = [];
    for (const race of RACES) {
        const status = document.getElementById("status");
        if (!race.uid) {
            // Placeholder race: no fetch needed.
            results.push({ uid: "", title: "", pilots: [], ok: true, placeholder: true });
            continue;
        }
        status.textContent = "Loading event " + race.uid + "…";
        try {
            const parsed = parseResults(await fetchPage("https://fpvscores.com/events/" + race.uid + "/ranking"));
            if (!parsed.pilots.length) throw new Error("no results found");
            // Fill in entry ids for pilots without a /ranking link: match them
            // against the /results page by real name, then callsign.
            if (parsed.pilots.some((p) => !p.slug)) {
                try {
                    const map = await fetchSlugMap(race.uid);
                    parsed.pilots.forEach((p) => {
                        if (!p.slug) {
                            p.slug = map[p.name] || map[p.cs] || null;
                            if (p.slug) p.slugIsUser = false;
                            if (!p.flag) p.flag = map["flag:" + p.name] || map["flag:" + p.cs] || null;
                        }
                    });
                } catch (e) { console.error("Slug map failed for " + race.uid, e); }
            }
            results.push({ uid: race.uid, title: parsed.title, pilots: parsed.pilots, ok: true });
        } catch (e) {
            console.error("Failed to load " + race.uid, e);
            results.push({ uid: race.uid, title: "", pilots: [], ok: false });
        }
    }
    buildTable(results);
})();
