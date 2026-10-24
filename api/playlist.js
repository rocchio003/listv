import { decode, collect } from './_lib.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const u = new URL(req.url);
  const q = u.searchParams;
  let cfg;
  try {
    cfg = await decode(q.get('c'));
  } catch {
    return new Response('Link non valido', { status: 400 });
  }

  // Elenco gruppi di una sorgente (usato dal pannello)
  if (q.has('groups')) {
    try {
      const items = await collect(cfg.s[+q.get('groups')], u.origin);
      const g = {};
      items.forEach((i) => (g[i.group] = (g[i.group] || 0) + 1));
      return Response.json(g);
    } catch (e) {
      return new Response(String(e), { status: 502 });
    }
  }

  // Playlist unita, in streaming (niente limite dei 4,5 MB)
  const act = cfg.s.filter((s) => s.e !== 0);
  const ps = act.map((s) => collect(s, u.origin).then((r) => ({ r }), (e) => ({ err: String(e) })));
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const te = new TextEncoder();
  (async () => {
    await w.write(te.encode('#EXTM3U\n'));
    for (let i = 0; i < act.length; i++) {
      const o = await ps[i];
      if (o.err) {
        await w.write(te.encode(`# ERRORE ${act[i].n}: ${o.err.replace(/\s+/g, ' ')}\n`));
        continue;
      }
      const ex = new Set(act[i].x || []);
      let out = '';
      for (const c of o.r) if (!ex.has(c.group)) out += c.inf + '\n' + c.extra + c.url + '\n';
      await w.write(te.encode(out));
    }
    await w.close();
  })();
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-mpegURL; charset=utf-8',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    },
  });
}
