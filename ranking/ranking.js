// Ranking, built from the static JSON files that scripts/update-data.mjs
// generates (GitHub Actions refreshes them daily; see events.js: DATA_BASE).
//
// The competition is chosen with the dropdown on the page (default from
// events.js: COMPETITION; the list comes from data/index.json, so
// data/manual-events.json is never offered). All past and upcoming events of
// the competition become race columns, oldest first. Upcoming events count as
// 100 points (PDRNL) or 1 point (DDR) until their results exist.
//
// Each competition's JSON is cached in localStorage, so a page reload renders
// instantly. The Refresh button re-fetches the JSON file.
const SCORED_RACES = 3; // how many lowest scores count towards the total

// --- Ranking systems ---
// "pdrnl": score = (position * 100) / pilots; total = sum of the SCORED_RACES
//          lowest scores; lower total is better.
// "ddr":   top 16 get 16 down to 1 point, everyone else gets 1 point; total =
//          sum of the SCORED_RACES highest scores; higher total is better.
//          Ties: first by best single-race result. The DDR rules also name the
//          fastest lap time as a second criterion, but lap times are not on the
//          FPVScores ranking pages, so ties beyond best result keep their order.
const RANKING_MODES = {
    pdrnl: { label: "PDRNL" },
    ddr:   { label: "DDR" }
};
const DEFAULT_MODE = "ddr";

function ddrPoints(pos) { return pos <= 16 ? 17 - pos : 1; }
function pdrnlPoints(pos, fieldSize) {
    return Math.round(pos * 100 / fieldSize * 10) / 10;
}

// Data lives at DATA_BASE (events.js): index.json for the dropdown, one
// <slug>.json per competition. Manual events never appear: the export script
// merges them into the competition files and only lists real competitions in
// index.json.
async function fetchJSON(file) {
    const res = await fetch(DATA_BASE + file, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + file);
    return res.json();
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

function buildTable(results, mode) {
    mode = RANKING_MODES[mode] ? mode : DEFAULT_MODE;
    const body = document.getElementById("ranking-body");

    // --- race header row ---
    const headRow = document.getElementById("race-header-row");
    // Remove only previously generated race headers, keep the fixed cells.
    headRow.querySelectorAll("th.race-th").forEach((th) => th.remove());
    results.forEach((r, i) => {
        const th = document.createElement("th");
        th.className = "num race-th";
        if (r.url) {
            const a = document.createElement("a");
            a.href = r.url.replace(/\/results$/, "") + "/ranking";
            a.target = "_blank";
            a.rel = "noopener";
            a.title = r.title || "Race on FPVScores";
            a.textContent = "Race " + (i + 1);
            th.appendChild(a);
        } else {
            th.textContent = "Race " + (i + 1);
            th.title = r.placeholder ? "Upcoming event - counts as 100 points (DDR: 1 point)" : "Not loaded - counts as 100 points (DDR: 1 point)";
        }
        headRow.appendChild(th);
    });

    // --- collect pilot scores keyed by real (small) name ---
    const pilots = new Map(); // name -> { name, url, scores: [{points, raceIdx}] }
    results.forEach((r, i) => {
        r.pilots.forEach((p) => {
            if (!pilots.has(p.name)) pilots.set(p.name, { name: p.name, url: null, flag: null, cs: "", scores: [] });
            const entry = pilots.get(p.name);
            if (!entry.url && p.url) entry.url = p.url;
            if (!entry.flag && p.flag) entry.flag = p.flag;
            if (!entry.cs && p.cs) entry.cs = p.cs;
            entry.scores.push({ points: ddrPoints(p.pos), pdrnl: pdrnlPoints(p.pos, p.fieldSize || r.pilots.length), raceIdx: i, pos: p.pos, slug: p.slug });
        });
    });

    // --- missing entries: every pilot not listed in a loaded event scores
    //     last-place points (100 in PDRNL, 1 in DDR) for that race ---
    results.forEach((r, i) => {
        if (!r.ok) return; // failed fetches keep a dash (defensive; JSON is pre-validated)
        for (const entry of pilots.values()) {
            if (!entry.scores.some((s) => s.raceIdx === i)) {
                entry.scores.push({ points: 1, pdrnl: 100, raceIdx: i, missed: true, placeholder: r.placeholder });
            }
        }
    });

    // --- totals ---
    // pdrnl: sum of the SCORED_RACES LOWEST scores (lower is better).
    // ddr:   sum of the SCORED_RACES HIGHEST scores (higher is better).
    const ddr = mode === "ddr";
    const entries = [...pilots.values()].map((p) => {
        const val = (s) => ddr ? s.points : s.pdrnl;
        // DDR: upcoming races count as 1 point too (everyone P16 or lower gets 1).
        const scores = p.scores.map((s) =>
            ({ points: val(s), raceIdx: s.raceIdx, missed: s.missed, placeholder: s.placeholder }));
        const sorted = [...scores].sort((a, b) => ddr ? b.points - a.points : a.points - b.points);
        const counted = sorted.slice(0, SCORED_RACES);
        return {
            name: p.name,
            url: p.url,
            flag: p.flag,
            cs: p.cs,
            scores: p.scores,
            countedIdx: new Set(counted.map((c) => c.raceIdx)),
            total: counted.reduce((s, c) => s + c.points, 0),
            bestRace: scores.reduce((m, s) => Math.max(m, s.points), 0)
        };
    });

    if (ddr) {
        // Most points first; ties broken by best single-race result.
        entries.sort((a, b) => b.total - a.total || b.bestRace - a.bestRace);
    } else {
        entries.sort((a, b) => a.total - b.total);
    }

    // --- render rows ---
    body.innerHTML = "";
    entries.forEach((entry, idx) => {
        const tr = document.createElement("tr");

        const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);

        const posClass = idx === 0 ? "pos r-1" : idx === 1 ? "pos r-2" : idx === 2 ? "pos r-3" : "pos other";
        let html = '<td class="rank-cell"><span class="' + posClass + '">' + (idx + 1) + "</span></td>";

        const nameHtml = entry.url
            ? '<a href="' + escapeHtml(entry.url) + '" target="_blank" rel="noopener">' + escapeHtml(entry.name) + "</a>"
            : escapeHtml(entry.name);
        const subHtml = entry.cs && entry.cs !== entry.name
            ? '<span class="pilot-sub">' + escapeHtml(entry.cs) + "</span>"
            : "";
        html += '<td class="pilot">' + nameHtml + (entry.flag ? ' <img class="flag-img" src="' + escapeHtml(entry.flag) + '" alt="" width="16" height="12" loading="lazy">' : "") + subHtml + "</td>";
        html += '<td class="num total-cell">' + fmt(entry.total) + "</td>";
        html += '<td class="sep"></td>';

        results.forEach((r, rIdx) => {
            const s = entry.scores.find((sc) => sc.raceIdx === rIdx);
            const dropped = s ? !entry.countedIdx.has(rIdx) : false;
            const title = dropped ? "Dropped score" : "";
            const cls = "num" + (dropped ? " dropped" : "");
            if (s && s.placeholder) {
                // Upcoming event: PDRNL counts it as 100, DDR counts it as 1 (everyone P16 or lower gets 1).
                html += '<td class="' + cls + '" title="Upcoming event - ' + (ddr ? "counts as 1 point" : "counts as 100 points") + (title ? "; " + title : "") + '">' + (ddr ? "1" : "100") + "</td>";
            } else if (s && s.missed) {
                html += '<td class="' + cls + '" title="No entry on FPVScores - counts as last place' + (title ? "; " + title : "") + '">' + (ddr ? "1" : "100") + "</td>";
            } else if (s) {
                const scoreTxt = fmt(ddr ? s.points : s.pdrnl);
                const podium = (s.pos && s.pos <= 3)
                    ? '<span class="podium p' + s.pos + '">' + scoreTxt + "</span>"
                    : '<span class="score-txt">' + scoreTxt + "</span>";
                if (s.slug && r.url) {
                    const href = r.url + "/" + encodeURIComponent(s.slug);
                    html += '<td class="' + cls + '"><a href="' + href + '" target="_blank" rel="noopener"' +
                        (title ? ' title="' + title + '"' : '') + ">" + podium + "</a></td>";
                } else {
                    html += '<td class="' + cls + '"' +
                        (title ? ' title="' + title + '"' : '') + ">" + podium + "</td>";
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
    let msg = loaded + " event" + (loaded === 1 ? "" : "s") + " loaded, total = sum of the " +
        SCORED_RACES + " best race scores (" + RANKING_MODES[mode].label + ").";
    if (failed.length) {
        msg += " Could not load: " + failed.map((r) => r.uid).join(", ");
    }
    status.textContent = msg;
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- data layer -------------------------------------------------------------
// Dropdown list: data/index.json, written by the export script with every
// competition it exported. data/manual-events.json is never listed there, so
// it can never show up in the dropdown.
async function getCompetitions() {
    return await fetchJSON("index.json");
}

// Load one competition from data/<slug>.json, via localStorage cache when
// available. force=true (Refresh button) re-fetches the JSON file.
async function loadCompetition(slug, force) {
    const status = document.getElementById("status");
    let cache = force ? null : cacheGet(compKey(slug));
    if (!cache) {
        status.textContent = "Loading " + slug + "…";
        cache = { ts: Date.now(), data: await fetchJSON(slug + ".json") };
        cacheSet(compKey(slug), cache);
    }

    const today = new Date().toISOString().slice(0, 10);
    const events = cache.data.events || [];
    const results = events.map((ev) => {
        const pilots = ev.pilots || [];
        return {
            uid: ev.uid,
            title: ev.title,
            url: ev.url || null,           // fpvscores results URL, null for manual events
            ok: pilots.length > 0,
            placeholder: !!(ev.upcoming || (ev.date && ev.date > today)),
            pilots: pilots
        };
    });
    return { events: events, results: results };
}

function setupControls() {
    const select = document.getElementById("comp-select");
    const btn = document.getElementById("refresh-btn");
    const status = document.getElementById("status");

    btn.addEventListener("click", async () => {
        const slug = select.value;
        if (!slug) return;
        await run(true);
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
                    o.textContent = c.name + " (" + (c.events != null ? c.events : c.races) + " races)";
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
        currentResults = results;
        buildTable(results, currentMode());
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


// --- ranking mode selection ---
let currentResults = null;
const MODE_KEY = "wr:mode";

function currentMode() {
    const m = localStorage.getItem(MODE_KEY);
    return RANKING_MODES[m] ? m : DEFAULT_MODE;
}

function setupModeSelect() {
    const modeSel = document.getElementById("mode-select");
    if (!modeSel) return null;
    modeSel.innerHTML = Object.keys(RANKING_MODES).map((m) =>
        '<option value="' + m + '">' + RANKING_MODES[m].label + "</option>").join("");
    modeSel.value = currentMode();
    modeSel.addEventListener("change", () => {
        localStorage.setItem(MODE_KEY, modeSel.value);
        if (currentResults) buildTable(currentResults, currentMode());
    });
    return modeSel;
}

(async function main() {
    cacheDel("wr:comps"); // page reload: always refresh the competition list
    const controls = await setupControls();
    setupControlsCache = controls;
    if (!controls) return; // no competitions -> nothing to do
    setupModeSelect();
    await controls.fill();
    await run(false);
})();
