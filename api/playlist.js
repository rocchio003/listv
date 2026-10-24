import { getCfg, collect, infParts, uh, applyOv } from './_lib.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const origin = `https://${req.headers.host}`;
  const q = new URL(req.url, origin).searchParams;
  let cfg;
  try {
    cfg = await getCfg(q);
  } catch {
    return res.status(400).send('Link non valido');
  }

  // Elenco gruppi di una sorgente (usato dal pannello)
  if (q.has('groups')) {
    try {
      const items = await collect(cfg.s[+q.get('groups')], origin);
      const g = {};
      items.forEach((i) => (g[i.group] = (g[i.group] || 0) + 1));
      return res.json(g);
    } catch (e) {
      return res.status(502).send(String(e));
    }
  }

  // Ricerca canali di una sorgente per la modifica (massimo 60 risultati)
  if (q.has('channels')) {
    try {
      const items = await collect(cfg.s[+q.get('channels')], origin);
      const needle = (q.get('q') || '').toLowerCase();
      const bad = q.get('bad') === '1';
      const out = [];
      let total = 0;
      for (const c of items) {
        const a = infParts(c.inf);
        if (bad && a.id) continue;
        if (needle && !`${a.name} ${a.id} ${c.group}`.toLowerCase().includes(needle)) continue;
        total++;
        if (out.length < 60) out.push({ h: uh(c.url), n: a.name, i: a.id, g: c.group, l: a.logo });
      }
      return res.json({ total, items: out });
    } catch (e) {
      return res.status(502).send(String(e));
    }
  }

  // Playlist unita, scritta a pezzi man mano che le liste rispondono
  const act = cfg.s.filter((s) => s.e !== 0);
  const ps = act.map((s) => collect(s, origin).then((r) => ({ r }), (e) => ({ err: String(e) })));
  res.setHeader('Content-Type', 'application/x-mpegURL; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  const epg = `${origin}/epg.xml?${q.has('k') ? 'k=' + q.get('k') : 'c=' + q.get('c')}`;
  res.write(`#EXTM3U url-tvg="${epg}" x-tvg-url="${epg}"\n`);
  for (let i = 0; i < act.length; i++) {
    const o = await ps[i];
    if (o.err) {
      res.write(`# ERRORE ${act[i].n}: ${o.err.replace(/\s+/g, ' ')}\n`);
      continue;
    }
    const s = act[i];
    const ex = new Set(s.x || []);
    const ov = s.o || {};
    const hasOv = Object.keys(ov).length > 0;
    const lab = String(s.n || '').replace(/"/g, "'");
    const tag = (c) => {
      const inf = hasOv ? applyOv(c.inf, ov[uh(c.url)]) : c.inf;
      if (!s.pf) return inf;
      // Opzione "nome lista nei gruppi": group-title diventa "Lista | Gruppo"
      return /group-title="/.test(inf)
        ? inf.replace(/group-title="([^"]*)"/, (m, g) => `group-title="${lab} | ${g || 'Senza gruppo'}"`)
        : inf.replace(/^#EXTINF:(-?[\d.]+)/, (m, d) => `#EXTINF:${d} group-title="${lab} | Senza gruppo"`);
    };
    let out = '';
    for (const c of o.r) if (!ex.has(c.group)) out += tag(c) + '\n' + c.extra + c.url + '\n';
    res.write(out);
  }
  res.end();
}
