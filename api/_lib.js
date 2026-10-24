const UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

export const b64e = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// La configurazione viaggia dentro il link: JSON -> deflate -> base64url
export async function decode(tok) {
  const st = new Blob([b64d(tok)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(st).text());
}

export const get = (url, headers = {}) =>
  fetch(url, { headers: { 'User-Agent': 'VLC/3.0.20', ...headers }, signal: AbortSignal.timeout(25000) });

export function parseM3U(txt) {
  const out = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#EXTM3U')) continue;
    if (l.startsWith('#EXTINF')) {
      cur = { inf: l, extra: '', group: (l.match(/group-title="([^"]*)"/) || [])[1] || 'Senza gruppo' };
    } else if (l.startsWith('#')) {
      if (cur) cur.extra += l + '\n';
    } else if (cur) {
      cur.url = l;
      out.push(cur);
      cur = null;
    }
  }
  return out;
}

// ---- Stalker ----
const apiUrl = (u) => {
  u = u.trim().replace(/\/+$/, '');
  return /\.php$/.test(u) ? u : u.replace(/\/c$/, '') + '/server/load.php';
};
export const sh = (mac, tok) => ({
  'User-Agent': UA,
  'X-User-Agent': 'Model: MAG250; Link: WiFi',
  Cookie: `mac=${mac}; stb_lang=it; timezone=Europe%2FRome`,
  ...(tok && { Authorization: 'Bearer ' + tok }),
});
export async function stalkerLogin(url, mac) {
  const api = apiUrl(url);
  const h = await (await get(`${api}?type=stb&action=handshake&token=&JsHttpRequest=1-xml`, sh(mac))).json();
  const tok = h.js.token;
  await get(`${api}?type=stb&action=get_profile&JsHttpRequest=1-xml`, sh(mac, tok)).catch(() => {});
  return { api, tok };
}

// Sorgente {t,n,u,a,p,m,x,e} -> [{group, inf, extra, url}]
export async function collect(s, origin) {
  if (s.t === 'stalker') {
    const { api, tok } = await stalkerLogin(s.u, s.m);
    const H = sh(s.m, tok);
    const gj = await (await get(`${api}?type=itv&action=get_genres&JsHttpRequest=1-xml`, H)).json();
    const gm = {};
    (gj.js || []).forEach((g) => (gm[g.id] = g.title));
    const cj = await (await get(`${api}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, H)).json();
    const sid = b64e(new TextEncoder().encode(`${s.u}|${s.m}`));
    return (cj.js.data || []).map((c) => {
      const g = String(gm[c.tv_genre_id] || 'Senza gruppo').replace(/"/g, "'");
      const logo = /^http/.test(c.logo || '') ? c.logo : '';
      return {
        group: g,
        inf: `#EXTINF:-1 tvg-id="${c.xmltv_id || ''}" tvg-logo="${logo}" group-title="${g}",${c.name}`,
        extra: '',
        url: `${origin}/api/play?s=${sid}&c=${encodeURIComponent(c.cmd)}`,
      };
    });
  }
  const url =
    s.t === 'xtream'
      ? `${s.u.trim().replace(/\/+$/, '')}/get.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}&type=m3u_plus&output=ts`
      : s.u.trim();
  const r = await get(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return parseM3U(await r.text());
}
