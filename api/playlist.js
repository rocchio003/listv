import {
  getCfg,
  collect,
  fetchXtreamGroups,
  groupAllowed,
  infParts,
  uh,
  applyOv,
  pickActive,
  testSource,
  xtStatus,
} from './_lib.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || (req.headers.host && req.headers.host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${req.headers.host}`;
  const q = new URL(req.url, origin).searchParams;

  let cfg;
  try {
    cfg = await getCfg(q);
  } catch (e) {
    return res.status(400).send('Link non valido: ' + (e.message || e));
  }

  // 1. Elenco gruppi di una sorgente Xtream (usato dal pannello)
  if (q.has('groups')) {
    try {
      const s = cfg.s[+q.get('groups')];
      if (!s) return res.status(404).send('Lista non trovata');
      const data = await fetchXtreamGroups(s);
      return res.json(data);
    } catch (e) {
      return res.status(502).send(String(e.message || e));
    }
  }

  // 2. Ricerca canali di una sorgente per eventuale modifica nome/tvg-id/logo
  if (q.has('channels')) {
    try {
      const s = cfg.s[+q.get('channels')];
      if (!s) return res.status(404).send('Lista non trovata');
      const items = await collect(s);
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
      return res.status(502).send(String(e.message || e));
    }
  }

  // 3. Test rapido singola lista
  if (q.has('test')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.send(await testSource(cfg.s[0]));
  }

  // 4. Stato account Xtream (libera / occupata / scaduta / offline)
  if (q.has('status')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await Promise.all((cfg.s || []).map((s) => xtStatus(s, q.get('fresh') === '1'))));
  }

  // 5. Anteprima / Verifica reale della playlist unita (usata dal pannello per confermare che funziona)
  if (q.has('preview')) {
    res.setHeader('Cache-Control', 'no-store');
    const { mode, act, skipped } = await pickActive(cfg, true);
    const results = await Promise.all(
      act.map((s) =>
        collect(s)
          .then((r) => ({ s, r }))
          .catch((e) => ({ s, err: String(e.message || e) }))
      )
    );

    const used = [];
    const errors = [];
    const groupCounts = {};
    let totalChannels = 0;

    for (const item of results) {
      if (item.err) {
        errors.push({ n: item.s.n, error: item.err });
        continue;
      }
      const lab = String(item.s.n || '').replace(/"/g, "'");
      let count = 0;
      const gSet = new Set();
      for (const c of item.r) {
        if (!groupAllowed(item.s, c.group)) continue;
        count++;
        const gOut = item.s.pf ? `${lab} | ${c.group}` : c.group;
        gSet.add(gOut);
        groupCounts[gOut] = (groupCounts[gOut] || 0) + 1;
      }
      totalChannels += count;
      used.push({ n: item.s.n, channels: count, groups: gSet.size });
    }

    const sortedGroups = Object.entries(groupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, ch]) => ({ name, channels: ch }));

    return res.json({
      ok: used.length > 0 && totalChannels > 0,
      mode,
      used,
      skipped,
      errors,
      totalChannels,
      totalGroups: Object.keys(groupCounts).length,
      sampleGroups: sortedGroups,
    });
  }

  // 6. Generazione playlist M3U unita
  res.setHeader('Content-Type', 'application/x-mpegURL; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const { act, notes } = await pickActive(cfg, false);
  const ps = act.map((s) =>
    collect(s).then(
      (r) => ({ r }),
      (e) => ({ err: String(e.message || e) })
    )
  );

  const epg = `${origin}/epg.xml?${q.has('k') ? 'k=' + encodeURIComponent(q.get('k')) : 'c=' + encodeURIComponent(q.get('c'))}`;
  res.write(`#EXTM3U url-tvg="${epg}" x-tvg-url="${epg}"\n`);
  if (notes) res.write(`# IPTV-HUB: ${notes.replace(/\s+/g, ' ')}\n`);

  for (let i = 0; i < act.length; i++) {
    const o = await ps[i];
    const s = act[i];
    if (o.err) {
      res.write(`# ERRORE ${s.n}: ${o.err.replace(/\s+/g, ' ')}\n`);
      continue;
    }
    const ov = s.o || {};
    const hasOv = Object.keys(ov).length > 0;
    const lab = String(s.n || '').replace(/"/g, "'");

    const formatInf = (c) => {
      const inf = hasOv ? applyOv(c.inf, ov[uh(c.url)]) : c.inf;
      if (!s.pf) return inf;
      return /group-title="/.test(inf)
        ? inf.replace(/group-title="([^"]*)"/, (m, g) => `group-title="${lab} | ${g || 'Senza gruppo'}"`)
        : inf.replace(/^#EXTINF:(-?[\d.]+)/, (m, d) => `#EXTINF:${d} group-title="${lab} | Senza gruppo"`);
    };

    let chunk = '';
    for (const c of o.r) {
      if (!groupAllowed(s, c.group)) continue;
      chunk += formatInf(c) + '\n' + c.extra + c.url + '\n';
      if (chunk.length > 131072) {
        res.write(chunk);
        chunk = '';
      }
    }
    if (chunk) res.write(chunk);
  }

  res.end();
}
