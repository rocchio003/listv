import { b64d, get, stalkerLogin } from './_lib.js';

export const config = { maxDuration: 30 };

// Risolve al volo il link Stalker (create_link) e fa redirect allo stream
export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  try {
    const d = new TextDecoder().decode(b64d(q.get('s')));
    const k = d.lastIndexOf('|');
    const url = d.slice(0, k), mac = d.slice(k + 1);
    const { api, H } = await stalkerLogin(url, mac);
    const j = await (
      await get(`${api}?type=itv&action=create_link&cmd=${encodeURIComponent(q.get('c'))}&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, H)
    ).json();
    res.redirect(302, String(j.js.cmd).split(' ').pop());
  } catch (e) {
    res.status(502).send(String(e));
  }
}
