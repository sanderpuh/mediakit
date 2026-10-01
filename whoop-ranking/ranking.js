// FPV Season Ranking — fetches results from fpvscores.com and builds the table.
// Points per event: (position * 100) / totalPilots.
// Total score: the sum of a pilot's three LOWEST points scores.

const RACES_SHOWN = 5;   // Race columns in the table
const SCORED_RACES = 3;  // how many lowest scores count towards the total

// The browser can't call fpvscores.com directly (CORS), so requests go through
// proxies that fetch the page server-side. corsproxy.io is fast but may reject
// some origins; r.jina.ai is the reliable fallback.
const PROXIES = [
    (t) => "https://r.jina.ai/" + t
];

async function fetchResults(uid) {
    const target = "https://fpvscores.com/events/" + uid + "/results";
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

function parseResults(doc) {
    const rows = doc.querySelectorAll("table.results-table tbody tr");
    const pilots = [];
    let total = 0;
    rows.forEach((tr) => {
        const posEl = tr.querySelector(".results-pos");
        const nameEl = tr.querySelector(".result-pilot__name");
        if (!posEl || !nameEl) return;
        const name = nameEl.textContent.trim();
        const pos = parseInt(posEl.textContent.trim(), 10);
        if (!isNaN(pos) && name) {
            pilots.push({ name: name, pos: pos });
            total++;
        }
    });
    // Points: (position * 100) / total pilots — lower is better
    pilots.forEach((p) => { p.points = (p.pos * 100) / (total || 1); });
    return pilots;
}

function buildTable(events, failed) {
    const pilots = new Map(); // name -> { scores: [ {points, eventIdx} ] }

    events.forEach((ev, i) => {
        ev.pilots.forEach((p) => {
            if (!pilots.has(p.name)) pilots.set(p.name, { name: p.name, scores: [] });
            pilots.get(p.name).scores.push({ points: p.points, eventIdx: i });
        });
    });

    const entries = [...pilots.values()].map((p) => {
        const sorted = [...p.scores].sort((a, b) => a.points - b.points);
        const counted = sorted.slice(0, SCORED_RACES);
        return {
            name: p.name,
            scores: p.scores,
            countedSet: new Set(counted),
            total: counted.reduce((s, c) => s + c.points, 0)
        };
    });

    entries.sort((a, b) => a.total - b.total);

    const body = document.getElementById("ranking-body");
    body.innerHTML = "";
    entries.forEach((entry, idx) => {
        const tr = document.createElement("tr");

        const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);

        const posClass = idx === 0 ? "pos r-1" : idx === 1 ? "pos r-2" : idx === 2 ? "pos r-3" : "pos other";
        let html = '<td><span class="' + posClass + '">' + (idx + 1) + "</span></td>";
        html += "<td>" + escapeHtml(entry.name) + "</td>";
        html += '<td class="num">' + fmt(entry.total) + "</td>";
        html += '<td class="sep"></td>';
        for (let r = 0; r < RACES_SHOWN; r++) {
            const s = entry.scores.find((sc) => sc.eventIdx === r);
            if (s) {
                const dropped = !entry.countedSet.has(s);
                html += '<td class="num' + (dropped ? " dropped" : "") + '" title="' +
                    (dropped ? "Dropped score" : "") + '">' + fmt(s.points) + "</td>";
            } else {
                html += '<td class="num missed">–</td>';
            }
        }
        tr.innerHTML = html;
        body.appendChild(tr);
    });

    const status = document.getElementById("status");
    const loaded = events.filter((e) => e.ok).length;
    let msg = loaded + " event" + (loaded === 1 ? "" : "s") + " loaded. Total = sum of the " +
        SCORED_RACES + " lowest race scores.";
    if (failed.length) {
        msg += " Could not load: " + failed.join(", ");
        status.style.color = "#e07a5f";
    }
    status.textContent = msg;
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

(async function main() {
    const failed = [];
    const events = [];
    for (const uid of EVENT_UIDS) {
        const status = document.getElementById("status");
        status.textContent = "Loading event " + uid + "…";
        try {
            const pilots = parseResults(await fetchResults(uid));
            if (!pilots.length) throw new Error("no results found");
            events.push({ uid: uid, pilots: pilots, ok: true });
        } catch (e) {
            console.error("Failed to load " + uid, e);
            failed.push(uid);
        }
    }
    buildTable(events, failed);
})();
