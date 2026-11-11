// Télécharge les calendriers MyFFF (.ics) listés dans data/calendriers.txt
// et fabrique data/matchs.json (liste des rencontres, sans doublons).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const urls = readFileSync("data/calendriers.txt", "utf8").split("\n")
  .map(l => l.trim()).filter(l => l && !l.startsWith("#"))
  .map(u => u.replace(/^webcal:\/\//, "https://"));

mkdirSync("data/brut", { recursive: true });

// Lecture d'un fichier ICS : lignes repliées, puis un objet par VEVENT
function parseICS(txt) {
  const lines = txt.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = []; let ev = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") { if (ev) out.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(":"); if (i < 0) continue;
      const [key, ...params] = l.slice(0, i).split(";");
      ev[key] = { value: l.slice(i + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";"), params };
    }
  }
  return out;
}

// Date ICS → ISO (gère « Z », TZID=Europe/Paris et dates sans heure)
function toISO(p) {
  if (!p) return null;
  const v = p.value, m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!m) return v;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (z) return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  // Heure locale de Paris : on calcule le décalage (hiver +01:00, été +02:00)
  const guess = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  const paris = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const off = Math.round((paris - utc) / 60000), sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0"), mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

const matchs = new Map();
for (const url of urls) {
  const id = (url.match(/\/([^/]+)\.ics$/) || [, "cal"])[1];
  try {
    const res = await fetch(url, { headers: { "User-Agent": "mon-petit-district (calendrier)" } });
    if (!res.ok) { console.log(`✗ ${id} : HTTP ${res.status}`); continue; }
    const txt = await res.text();
    writeFileSync(`data/brut/${id}.ics`, txt);
    const evs = parseICS(txt);
    console.log(`✓ ${id} : ${evs.length} rencontres`);
    for (const e of evs) {
      const summary = e.SUMMARY?.value || "";
      const key = e.UID?.value || `${summary}|${e.DTSTART?.value}`;
      matchs.set(key, {
        uid: key,
        date: toISO(e.DTSTART),
        titre: summary,
        lieu: e.LOCATION?.value || "",
        description: e.DESCRIPTION?.value || ""
      });
    }
  } catch (err) { console.log(`✗ ${id} : ${err.message}`); }
}

const liste = [...matchs.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
writeFileSync("data/matchs.json", JSON.stringify({ maj: new Date().toISOString(), matchs: liste }, null, 2) + "\n");
console.log(`→ data/matchs.json : ${liste.length} rencontres`);
