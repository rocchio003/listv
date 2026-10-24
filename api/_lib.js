import { createHash } from 'node:crypto';

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
async function jget(url, headers, what, meta) {
  const r = await get(url, headers);
  if (meta) meta.cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
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

export const sh = (mac, tok, ref, extra = []) => ({
  'User-Agent': UA,
  'X-User-Agent': 'Model: MAG250; Link: WiFi',
  Accept: '*/*',
  Cookie: [`mac=${mac}`, 'stb_lang=it', 'timezone=Europe%2FRome', ...extra].join('; '),
  ...(ref && { Referer: ref }),
  ...(tok && { Authorization: 'Bearer ' + tok }),
});

const hash = (alg, v) => createHash(alg).update(v).digest('hex');

// Handshake + profilo da MAG250 (molti portali non consegnano i canali senza profilo)
export async function stalkerLogin(url, mac) {
  const errs = [];
  const sn = hash('md5', mac).toUpperCase().slice(0, 13);
  const did = hash('sha256', mac).toUpperCase();
  for (const api of candidates(url)) {
    try {
      const meta = {};
      const h = await jget(`${api}?type=stb&action=handshake&token=&prehash=0&JsHttpRequest=1-xml`, sh(mac, null, url), 'handshake', meta);
      const tok = h.js && h.js.token;
      if (!tok) throw new Error('handshake senza token');
      const H = sh(mac, tok, url, meta.cookies || []);
      const prof = new URLSearchParams({
        type: 'stb', action: 'get_profile', hd: '1',
        ver: 'ImageDescription: 0.2.18-r23-250; ImageDate: Wed Aug 29 10:49:53 EEST 2018; PORTAL version: 5.5.0; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c',
        num_banks: '2', sn, stb_type: 'MAG250', image_version: '218', video_out: 'hdmi',
        device_id: did, device_id2: did, signature: '', auth_second_step: '1', hw_version: '1.7-BD-00',
        not_valid_token: '0', client_type: 'STB', hw_version_2: hash('sha1', mac),
        timestamp: String(Math.floor(Date.now() / 1000)), api_signature: '262',
        metrics: JSON.stringify({ mac, sn, type: 'STB', model: 'MAG250', uid: '', random: (h.js && h.js.random) || '' }),
        JsHttpRequest: '1-xml',
      });
      await get(`${api}?${prof}`, H).catch(() => {});
      return { api, tok, H };
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
        H, 'lista canali').catch((e) => {
        throw new Error(e.message + '. Il portale non consegna i canali: MAC non attivo/scaduto oppure blocca l’IP di Vercel');
      });
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
    const { api, H } = await stalkerLogin(s.u, s.m);
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

// ---- EPG ----
export const getLong = (url) =>
  fetch(url, { headers: { 'User-Agent': 'VLC/3.0.20' }, signal: AbortSignal.timeout(55000) });

// Link EPG da unire: quelli inseriti a mano + xmltv.php delle liste Xtream + url-tvg nell'intestazione delle liste M3U
export async function epgUrls(cfg) {
  const out = [...(cfg.g || [])];
  const act = (cfg.s || []).filter((s) => s.e !== 0);
  await Promise.all(
    act.map(async (s) => {
      try {
        if (s.t === 'xtream') {
          out.push(`${s.u.trim().replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}`);
        } else if (s.t === 'm3u') {
          const r = await get(s.u.trim());
          const rd = r.body.getReader();
          const { value } = await rd.read();
          rd.cancel().catch(() => {});
          const head = new TextDecoder().decode(value || new Uint8Array()).split(/\r?\n/)[0];
          const m = head.match(/(?:url-tvg|x-tvg-url)="([^"]*)"/);
          if (m) out.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
        }
      } catch {}
    })
  );
  return [...new Set(out)];
}

// ---- Archivio condiviso (Upstash Redis collegato da Vercel) ----
const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'iptvhub:cfg';
const dbAuth = () => {
  if (!DB_URL || !DB_TOK) throw new Error('Database Redis non collegato al progetto Vercel');
  return { Authorization: 'Bearer ' + DB_TOK };
};
export async function loadCfg() {
  const j = await (await fetch(`${DB_URL}/get/${DB_KEY}`, { headers: dbAuth() })).json();
  return j.result ? JSON.parse(j.result) : { s: [], g: [] };
}
export async function saveCfg(cfg) {
  const r = await fetch(DB_URL, { method: 'POST', headers: dbAuth(), body: JSON.stringify(['SET', DB_KEY, JSON.stringify(cfg)]) });
  if (!r.ok) throw new Error('Salvataggio fallito');
}
// Configurazione da ?k=chiave (archivio) oppure da ?c=token (vecchi link, tutto dentro il link)
export async function getCfg(q) {
  if (q.has('k')) {
    const cfg = await loadCfg();
    if (!cfg.k || cfg.k !== q.get('k')) throw new Error('Chiave non valida');
    return cfg;
  }
  return decode(q.get('c'));
}
