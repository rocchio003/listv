import { b64d, get, sh, stalkerLogin } from './_lib.js';

export const config = { runtime: 'edge' };

// Risolve al volo il link Stalker (create_link) e fa redirect allo stream
export default async function handler(req) {
  const q = new URL(req.url).searchParams;
  try {
    const d = new TextDecoder().decode(b64d(q.get('s')));
    const k = d.lastIndexOf('|');
    const url = d.slice(0, k), mac = d.slice(k + 1);
    const { api, tok } = await stalkerLogin(url, mac);
    const j = await (
      await get(`${api}?type=itv&action=create_link&cmd=${encodeURIComponent(q.get('c'))}&JsHttpRequest=1-xml`, sh(mac, tok))
    ).json();
    return Response.redirect(String(j.js.cmd).split(' ').pop(), 302);
  } catch (e) {
    return new Response(String(e), { status: 502 });
  }
}
