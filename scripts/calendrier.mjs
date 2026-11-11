// Télécharge les calendriers MyFFF (.ics) listés dans data/calendriers.txt
// et fabrique data/matchs.json (liste des rencontres, sans doublons).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const urls = readFileSync("data/calendriers.txt", "utf8").split("\n")
  .map(l => l.trim()).filter(l => l && !l.startsWith("#"))
  .map(u => u.replace(/^webcal:\/\//, "https://"));

mkdirSync("data/brut", { recursive: true });
const COMPETITION = "DEPARTEMENTAL 3";   // compétition gardée (les coupes sont ignorées)

// Lecture d'un fichier ICS : lignes repliées, puis un objet par VEVENT
function parseICS(txt) {
  const lines = txt.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = []; let ev = null, alarm = false;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") { if (ev) out.push(ev); ev = null; }
    else if (l === "BEGIN:VALARM") alarm = true;
    else if (l === "END:VALARM") alarm = false;
    else if (ev && !alarm) {
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
const vuDans = new Map();      // uid → ensemble des calendriers qui contiennent ce match
const equipeDu = new Map();    // calendrier → équipe à qui il appartient
const N = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
for (const url of urls) {
  const id = (url.match(/\/([^/]+)\.ics$/) || [, "cal"])[1];
  try {
    // On essaie plusieurs « identités » : appli Calendrier iPhone, Safari, Chrome
    const AGENTS = [
      "iOS/18.1 (22B83) dataaccessd/1.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ];
    let txt = null;
    for (const ua of AGENTS) {
      const res = await fetch(url, { headers: { "User-Agent": ua, "Accept": "text/calendar,*/*", "Accept-Language": "fr-FR,fr;q=0.9" } });
      console.log(`  ${id} [${ua.slice(0, 22)}…] → HTTP ${res.status}`);
      if (res.ok) { txt = await res.text(); break; }
    }
    if (!txt) { console.log(`✗ ${id} : refusé`); continue; }
    writeFileSync(`data/brut/${id}.ics`, txt);
    const evs = parseICS(txt);
    const nom = (txt.match(/X-WR-CALNAME:(.*)/) || [, "?"])[1].trim();
    console.log(`✓ ${id} : ${evs.length} rencontres — ${nom}`);
    for (const e of evs) {
      const summary = e.SUMMARY?.value || "", desc = e.DESCRIPTION?.value || "";
      const competition = desc.split("\n")[0].trim();
      if (competition.toUpperCase() !== COMPETITION) continue;          // pas les coupes
      const m = summary.match(/^J(\d+)\s+-\s+(.+?)\s+-\s+(.+)$/);
      if (!m) { console.log(`  ? format inconnu : ${summary}`); continue; }
      const uid = (e.UID?.value || summary).replace(/@fff\.fr$/, "");
      if (!vuDans.has(uid)) vuDans.set(uid, new Set());
      vuDans.get(uid).add(id);
      const cpt = equipeDu.get(id) || new Map(); equipeDu.set(id, cpt);
      for (const t of [m[2], m[3]]) cpt.set(N(t), (cpt.get(N(t)) || 0) + 1);
      matchs.set(uid, {
        uid, j: +m[1], domicile: m[2].trim(), exterieur: m[3].trim(),
        date: toISO(e.DTSTART),
        lieu: e.LOCATION?.value || "",
        fiche: (desc.match(/https:\/\/epreuves\.fff\.fr\S+/) || [""])[0],
        _maj: e.DTSTAMP?.value || ""
      });
    }
  } catch (err) { console.log(`✗ ${id} : ${err.message}`); }
}

// Tri des matchs fantômes : un vrai match figure dans le calendrier de CHAQUE équipe dont on a le lien.
// (La FFF laisse parfois d'anciens matchs annulés dans le calendrier d'une seule des deux équipes.)
const calDe = new Map();       // équipe → calendrier
for (const [id, cpt] of equipeDu) { const [nom] = [...cpt].sort((a, b) => b[1] - a[1])[0] || []; if (nom) calDe.set(nom, id) }
for (const [uid, m] of matchs) {
  const manque = [m.domicile, m.exterieur].filter(t => calDe.has(N(t)) && !vuDans.get(uid).has(calDe.get(N(t))));
  if (manque.length) { console.log(`  ✂ match fantôme retiré : J${m.j} ${m.domicile} - ${m.exterieur} (${uid})`); matchs.delete(uid) }
}

// Une équipe ne joue qu'une fois par journée : en cas de doublon, on garde la version la plus récente
// (la FFF a remanié une partie du calendrier ; les anciennes versions traînent parfois dans les fichiers).
const parEquipe = new Map();
for (const [uid, m] of [...matchs].sort((a, b) => b[1]._maj.localeCompare(a[1]._maj))) {
  const cles = [m.domicile, m.exterieur].map(t => `${m.j}|${N(t)}`);
  if (cles.some(k => parEquipe.has(k))) { console.log(`  ✂ ancienne version retirée : J${m.j} ${m.domicile} - ${m.exterieur} (${uid})`); matchs.delete(uid); continue }
  cles.forEach(k => parEquipe.set(k, uid));
}
for (const m of matchs.values()) delete m._maj;

const liste = [...matchs.values()].sort((a, b) => a.j - b.j || String(a.date).localeCompare(String(b.date)));
// On ne réécrit le fichier que si les rencontres ont changé (évite un commit chaque jour)
let ancien = null; try { ancien = JSON.parse(readFileSync("data/matchs.json", "utf8")) } catch (e) {}
if (liste.length && (!ancien || JSON.stringify(ancien.matchs) !== JSON.stringify(liste)))
  writeFileSync("data/matchs.json", JSON.stringify({ maj: new Date().toISOString(), matchs: liste }, null, 2) + "\n");
else console.log("  (aucun changement dans les rencontres)");
console.log(`→ data/matchs.json : ${liste.length} rencontres`);
