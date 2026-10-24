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
// GET che ritorna JSON; se la risposta è vuota/non JSON, l'errore dice cosa è arrivato
async function jget(url, headers, what) {
  const r = await get(url, headers);
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`${what}: HTTP ${r.status}, risposta non valida (${t.slice(0, 80).replace(/\s+/g, ' ') || 'vuota'})`);
  }
}

// Endpoint possibili del portale: li proviamo in ordine finché uno risponde
const candidates = (u) => {
  u = u.trim().replace(/\/+$/, '');
  if (/\.php$/.test(u)) return [u];
  const b = u.replace(/\/c$/, '');
  const c = [b + '/server/load.php', b + '/portal.php'];
  if (!b.includes('stalker_portal')) c.push(b + '/stalker_portal/server/load.php');
  return c;
};

export const sh = (mac, tok, ref) => ({
  'User-Agent': UA,
  'X-User-Agent': 'Model: MAG250; Link: WiFi',
  Accept: '*/*',
  Cookie: `mac=${mac}; stb_lang=it; timezone=Europe%2FRome`,
  ...(ref && { Referer: ref }),
  ...(tok && { Authorization: 'Bearer ' + tok }),
});

export async function stalkerLogin(url, mac) {
  const errs = [];
  for (const api of candidates(url)) {
    try {
      const h = await jget(`${api}?type=stb&action=handshake&token=&prehash=0&JsHttpRequest=1-xml`, sh(mac, null, url), 'handshake');
      const tok = h.js && h.js.token;
      if (!tok) throw new Error('handshake senza token');
      await get(`${api}?type=stb&action=get_profile&JsHttpRequest=1-xml`, sh(mac, tok, url)).catch(() => {});
      return { api, tok };
    } catch (e) {
      errs.push(`${api.replace(/^https?:\/\/[^/]+/, '')} → ${e.message}`);
    }
  }
  throw new Error('Login Stalker fallito. ' + errs.join(' | '));
}

async function stalkerChannels(api, H) {
  let data = [], err;
  try {
    const cj = await jget(`${api}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, H, 'canali');
    data = (cj.js && cj.js.data) || [];
  } catch (e) {
    err = e;
  }
  if (!data.length) {
    // Alcuni portali non supportano get_all_channels: lista paginata
    for (let p = 1; p <= 300; p++) {
      const oj = await jget(
        `${api}?type=itv&action=get_ordered_list&genre=*&force_ch_link_check=&fav=0&sortby=number&hd=0&p=${p}&JsHttpRequest=1-xml`,
        H, 'lista canali');
      const d = (oj.js && oj.js.data) || [];
      if (!d.length) break;
      data.push(...d);
      const tot = +(oj.js && oj.js.total_items) || 0;
      if (tot && data.length >= tot) break;
    }
  }
  if (!data.length) throw err || new Error('Nessun canale trovato nel portale');
  return data;
}

// Sorgente {t,n,u,a,p,m,x,e} -> [{group, inf, extra, url}]
export async function collect(s, origin) {
  if (s.t === 'stalker') {
    const { api, tok } = await stalkerLogin(s.u, s.m);
    const H = sh(s.m, tok, s.u);
    const gj = await jget(`${api}?type=itv&action=get_genres&JsHttpRequest=1-xml`, H, 'generi').catch(() => ({}));
    const gm = {};
    (Array.isArray(gj.js) ? gj.js : []).forEach((g) => (gm[g.id] = g.title));
    const data = await stalkerChannels(api, H);
    const sid = b64e(new TextEncoder().encode(`${s.u}|${s.m}`));
    return data.map((c) => {
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
