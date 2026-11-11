// Test : que contient une fiche match FFF ? (affiché dans le journal, rien n'est enregistré)
const url = "https://epreuves.fff.fr/competition/match/55853907-s-l-de-l-ornel-a-chancenay-a-s-chamouilley-roches-s-marne/match";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR" } });
const t = await r.text();
console.log("HTTP", r.status, "taille", t.length);
for (const k of ["score", "Score", "but", "api", "json", "__NEXT_DATA__", "apollo", "ORNEL", "drupal", "match_id", "home_score", "away"]) {
  const i = t.indexOf(k); console.log(`--- ${k} @${i}`); if (i >= 0) console.log(t.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, " "));
}
const urls = [...new Set((t.match(/https?:\/\/[a-z0-9.-]*fff\.fr\/[^"' <)]+/g) || []))].filter(u => /api|json/i.test(u)).slice(0, 20);
console.log("URLs API :", urls);
