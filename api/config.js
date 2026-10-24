import { randomUUID } from 'node:crypto';
import { loadCfg, saveCfg } from './_lib.js';

// Legge/salva la configurazione condivisa tra i dispositivi (protetta da ADMIN_PASSWORD)
export default async function handler(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(401).send('ADMIN_PASSWORD non impostata su Vercel');
  if (req.headers['x-admin'] !== pw) return res.status(401).send('Password errata');
  try {
    const cur = await loadCfg();
    if (!cur.k) cur.k = randomUUID().replace(/-/g, '');
    if (req.method === 'PUT') {
      const b = req.body || {};
      await saveCfg({ s: b.s || [], g: b.g || [], k: cur.k });
      return res.json({ ok: true });
    }
    await saveCfg(cur);
    res.json({ cfg: cur });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
}
