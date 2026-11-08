// Legge le liste dal Gist dell'IPTV Manager e le converte nel formato di questa app.
// Variabili su Vercel: GIST_ID (obbligatoria), GIST_TOKEN (consigliata), GIST_FILE (default iptv-manager.json)
const T = (v) => String(v ?? '').trim();

// Un link che punta a questo stesso sito (o a un altro deploy dell'app) non va importato: si includerebbe da solo
const isSelf = (u, host) => {
  try {
    const x = new URL(u);
    return /\/(playlist\.m3u|api\/playlist)$/.test(x.pathname) && (x.hostname === host || x.hostname.endsWith('.vercel.app'));
  } catch {
    return false;
  }
};
// Le pagine "blob" di GitHub sono HTML: si scarica la versione raw
const raw = (u) => T(u).replace(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\//, '$1/raw/');

export default async function handler(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || req.headers['x-admin'] !== pw) return res.status(401).send('Password errata');
  const id = process.env.GIST_ID;
  if (!id) return res.status(204).end();
  try {
    const H = {
      'User-Agent': 'iptv-hub',
      Accept: 'application/vnd.github+json',
      ...(process.env.GIST_TOKEN && { Authorization: 'Bearer ' + process.env.GIST_TOKEN }),
    };
    const r = await fetch(`https://api.github.com/gists/${id}`, { headers: H });
    if (!r.ok) throw new Error('GitHub HTTP ' + r.status);
    const name = process.env.GIST_FILE || 'iptv-manager.json';
    const f = ((await r.json()).files || {})[name];
    if (!f) throw new Error(`File ${name} non trovato nel Gist`);
    const d = JSON.parse(f.truncated ? await (await fetch(f.raw_url, { headers: H })).text() : f.content);

    const host = req.headers.host;
    const s = [], skipped = [], epgIds = new Set();
    for (const x of d.xtream || []) {
      s.push({ gid: x.id || `x-${T(x.host)}-${T(x.user)}`, t: 'xtream', n: T(x.name) || T(x.host), u: T(x.host).replace(/\/+$/, ''), a: T(x.user), p: T(x.pass), pl: 1 });
      if (x.epg) epgIds.add(x.epg);
    }
    for (const m of d.m3u || []) {
      if (isSelf(m.url, host)) { skipped.push(T(m.name)); continue; }
      s.push({ gid: m.id || `m-${T(m.url)}`, t: 'm3u', n: T(m.name) || T(m.url), u: T(m.url) });
      if (m.epg) epgIds.add(m.epg);
    }
    // Stalker: importate ma spente (per ora non si usano)
    for (const k of d.stalker || []) {
      s.push({ gid: k.id || `s-${T(k.url)}-${T(k.mac)}`, t: 'stalker', n: T(k.name) || T(k.url), u: T(k.url), m: T(k.mac).toUpperCase(), off: 1 });
    }
    // EPG: solo quelli collegati alle liste (importarli tutti renderebbe l'EPG unito enorme)
    const g = (d.epg || []).filter((e) => epgIds.has(e.id) && e.url).map((e) => raw(e.url));
    res.json({ s, g: [...new Set(g)], skipped });
  } catch (e) {
    res.status(502).send(String(e.message || e));
  }
}
