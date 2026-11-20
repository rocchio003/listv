import { randomUUID } from 'node:crypto';
import { hasDb, loadCfg, saveCfg } from './_lib.js';

export const config = { maxDuration: 30 };

// Legge/salva la configurazione condivisa su Redis (protetta da ADMIN_PASSWORD)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    return res.status(503).json({
      ok: false,
      code: 'NO_ADMIN_PW',
      error: 'Variabile ADMIN_PASSWORD non impostata su Vercel',
    });
  }
  if (req.headers['x-admin'] !== pw) {
    return res.status(401).json({
      ok: false,
      code: 'BAD_PW',
      error: 'Password errata',
    });
  }
  if (!hasDb()) {
    return res.status(503).json({
      ok: false,
      code: 'NO_DB',
      error: 'Database Upstash/KV Redis non collegato su Vercel',
    });
  }

  try {
    const cur = await loadCfg();
    if (!cur.k) cur.k = randomUUID().replace(/-/g, '');

    if (req.method === 'PUT') {
      const b = req.body || {};
      const next = {
        k: cur.k,
        mode: b.mode === 'pool' ? 'pool' : 'manual',
        n: Math.max(1, +b.n || 3),
        s: Array.isArray(b.s) ? b.s : [],
      };
      await saveCfg(next);
      return res.json({ ok: true, k: cur.k });
    }

    await saveCfg(cur);
    return res.json({
      ok: true,
      cfg: {
        k: cur.k,
        mode: cur.mode === 'pool' ? 'pool' : 'manual',
        n: Math.max(1, +cur.n || 3),
        s: (cur.s || []).filter((s) => !s.t || s.t === 'xtream'),
      },
      env: {
        gist: Boolean(process.env.GIST_ID),
        gistFile: process.env.GIST_FILE || 'iptv-manager.json',
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'ERR', error: String(e.message || e) });
  }
}
