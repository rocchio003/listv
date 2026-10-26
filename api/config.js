<<<<<<< HEAD
import { randomUUID, timingSafeEqual } from 'node:crypto';
=======
import { randomUUID } from 'node:crypto';
>>>>>>> f25d892d773ca18792375910bfddbd991e0c0b10
import { loadCfg, saveCfg } from './_lib.js';

// Legge/salva la configurazione condivisa tra i dispositivi (protetta da ADMIN_PASSWORD)
export default async function handler(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(401).send('ADMIN_PASSWORD non impostata su Vercel');
<<<<<<< HEAD
  const userPw = req.headers['x-admin'] || '';
  let isValid = false;
  try {
    const bufA = Buffer.from(pw);
    const bufB = Buffer.from(userPw);
    if (bufA.length === bufB.length) {
      isValid = timingSafeEqual(bufA, bufB);
    }
  } catch {}
  if (!isValid) return res.status(401).send('Password errata');
=======
  if (req.headers['x-admin'] !== pw) return res.status(401).send('Password errata');
>>>>>>> f25d892d773ca18792375910bfddbd991e0c0b10
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
