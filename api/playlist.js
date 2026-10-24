import { getCfg, collect } from './_lib.js';

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
    const ex = new Set(act[i].x || []);
    const lab = String(act[i].n || '').replace(/"/g, "'");
    // Opzione "nome lista nei gruppi": group-title diventa "Lista | Gruppo"
    const tag = (c) =>
      !act[i].pf ? c.inf
      : /group-title="/.test(c.inf) ? c.inf.replace(/group-title="([^"]*)"/, (m, g) => `group-title="${lab} | ${g || 'Senza gruppo'}"`)
      : c.inf.replace(/^#EXTINF:(-?[\d.]+)/, (m, d) => `#EXTINF:${d} group-title="${lab} | Senza gruppo"`);
    let out = '';
    for (const c of o.r) if (!ex.has(c.group)) out += tag(c) + '\n' + c.extra + c.url + '\n';
    res.write(out);
  }
  res.end();
}
