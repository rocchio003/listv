// Importa le sole liste Xtream da un GitHub Gist.
// Variabili su Vercel: GIST_ID (obbligatoria), GIST_TOKEN (consigliata per Gist privati o rate limit), GIST_FILE (default iptv-manager.json)
const T = (v) => String(v ?? '').trim();
const cleanUrl = (u) => T(u).replace(/\/+$/, '');

function extractXtream(d) {
  const list = Array.isArray(d) ? d : Array.isArray(d && d.xtream) ? d.xtream : [];
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const u = cleanUrl(x.host || x.url || x.server || x.u);
    const a = T(x.user || x.username || x.a);
    const p = T(x.pass || x.password || x.p);
    if (!u || !a || !p) continue;
    const n = T(x.name || x.title || x.n) || u.replace(/^https?:\/\//, '');
    const gid = T(x.id || x.gid) || `x-${u}-${a}`;
    out.push({ gid, t: 'xtream', n, u, a, p });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || req.headers['x-admin'] !== pw) {
    return res.status(401).json({ ok: false, error: 'Password errata' });
  }

  const id = process.env.GIST_ID;
  if (!id) {
    return res.json({ ok: true, configured: false, s: [], message: 'Variabile GIST_ID non impostata su Vercel.' });
  }

  try {
    const H = {
      'User-Agent': 'iptv-hub',
      Accept: 'application/vnd.github+json',
      ...(process.env.GIST_TOKEN && { Authorization: 'Bearer ' + process.env.GIST_TOKEN }),
    };
    const r = await fetch(`https://api.github.com/gists/${id}`, { headers: H, cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);

    const gist = await r.json();
    const files = gist.files || {};
    const wanted = process.env.GIST_FILE || 'iptv-manager.json';
    const file = files[wanted] || (Object.keys(files).length === 1 ? Object.values(files)[0] : null);
    if (!file) {
      throw new Error(`File "${wanted}" non trovato nel Gist (trovati: ${Object.keys(files).join(', ') || 'nessuno'})`);
    }

    const rawText = file.truncated ? await (await fetch(file.raw_url, { headers: H })).text() : file.content;
    const parsed = JSON.parse(rawText);
    const s = extractXtream(parsed);

    return res.json({
      ok: true,
      configured: true,
      file: file.filename || wanted,
      total: s.length,
      s,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
