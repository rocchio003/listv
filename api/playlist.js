import { collect, infParts, uh, applyOv } from './_lib.js';

export const config = { maxDuration: 60 };

// Recupera configurazione dal database usando la chiave
async function getUserCfg(key) {
  const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const DB_KEY = 'iptvhub:cfg';
  
  if (!DB_URL || !DB_TOK) throw new Error('Database non configurato');
  
  const r = await fetch(`${DB_URL}/get/${DB_KEY}`, { 
    headers: { Authorization: 'Bearer ' + DB_TOK } 
  });
  const j = await r.json();
  if (!j.result) throw new Error('Nessuna configurazione salvata');
  
  const cfg = JSON.parse(j.result);
  if (!cfg.k || cfg.k !== key) throw new Error('Chiave non valida');
  return cfg;
}

// Decodifica configurazione inline (metodo vecchio)
async function getInlineCfg(token) {
  const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([b64d(token)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}

export default async function handler(req, res) {
  const origin = `https://${req.headers.host}`;
  const q = new URL(req.url, origin).searchParams;
  let cfg;
  
  try {
    if (q.has('k')) {
      cfg = await getUserCfg(q.get('k'));
    } else if (q.has('c')) {
      cfg = await getInlineCfg(q.get('c'));
    } else {
      throw new Error('Parametro mancante');
    }
  } catch (e) {
    return res.status(400).send('Link non valido: ' + e.message);
  }

  // Elenco gruppi
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

  // Ricerca canali
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

  // Playlist M3U
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
