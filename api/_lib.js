import { createHash } from 'node:crypto';

export const b64e = (u8) =>
  btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const b64d = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function decode(tok) {
  const st = new Blob([b64d(tok)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(st).text());
}

export const get = (url, headers = {}, ms = 25000) =>
  fetch(url, { headers: { 'User-Agent': 'VLC/3.0.20', ...headers }, signal: AbortSignal.timeout(ms) });

export const getLong = (url) => get(url, {}, 35000);

export const cleanBase = (u) => String(u || '').trim().replace(/\/+$/, '');

// type=m3u -> solo canali live (niente film/serie). Se un pannello ignora il parametro,
// le esclusioni manuali dei gruppi restano comunque attive come rete di sicurezza.
export const xtM3uUrl = (s) =>
  `${cleanBase(s.u)}/get.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}&type=m3u&output=ts`;

export const xtEpgUrl = (s) =>
  `${cleanBase(s.u)}/xmltv.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}`;

export const xtApiUrl = (s, action = '') =>
  `${cleanBase(s.u)}/player_api.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}${action ? '&action=' + action : ''}`;

export function parseM3U(txt) {
  const out = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#EXTM3U')) continue;
    if (l.startsWith('#EXTINF')) {
      const m = l.match(/group-title="([^"]*)"/);
      cur = { inf: l, extra: '', group: (m && m[1]) || 'Senza gruppo' };
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

export function parseGroupsOnly(txt) {
  const counts = {};
  let pos = 0;
  while (true) {
    const idx = txt.indexOf('#EXTINF', pos);
    if (idx === -1) break;
    const eol = txt.indexOf('\n', idx);
    const line = eol === -1 ? txt.slice(idx) : txt.slice(idx, eol);
    const m = line.match(/group-title="([^"]*)"/);
    const g = (m && m[1]) || 'Senza gruppo';
    counts[g] = (counts[g] || 0) + 1;
    pos = eol === -1 ? txt.length : eol + 1;
  }
  return counts;
}

export async function collect(s) {
  const r = await get(xtM3uUrl(s));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  if (!txt.includes('#EXTINF')) {
    throw new Error('Risposta non valida (non contiene canali #EXTINF)');
  }
  return parseM3U(txt);
}

// Recupera i gruppi di una lista Xtream: prova da get.php (con conteggi reali),
// con fallback istantaneo sulle API categorie Xtream se get.php fallisce o è vuoto.
export async function fetchXtreamGroups(s) {
  try {
    const r = await get(xtM3uUrl(s), {}, 18000);
    if (r.ok) {
      const txt = await r.text();
      if (txt.includes('#EXTINF')) {
        const g = parseGroupsOnly(txt);
        if (Object.keys(g).length) return { groups: g, source: 'm3u' };
      }
    }
  } catch {}

  const r = await get(xtApiUrl(s, 'get_live_categories'), {}, 10000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const cats = await r.json();
  if (!Array.isArray(cats)) throw new Error('Categorie non disponibili');
  const groups = {};
  for (const c of cats) {
    if (c && c.category_name) groups[String(c.category_name)] = null;
  }
  return { groups, source: 'api' };
}

// ---- Filtro gruppi per sorgente ----
// gm === 'in' -> whitelist (include SOLO i gruppi presenti in gr)
// altrimenti -> blacklist (include tutti TRANNE quelli in x)
export function groupAllowed(s, groupName) {
  if (s.gm === 'in') {
    const inc = s.gr || [];
    return inc.includes(groupName);
  }
  const ex = s.x || [];
  return !ex.includes(groupName);
}

// ---- Archivio condiviso (Upstash Redis collegato da Vercel) ----
const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'iptvhub:cfg';

export const hasDb = () => Boolean(DB_URL && DB_TOK);

const dbAuth = () => {
  if (!DB_URL || !DB_TOK) throw new Error('Database Redis non collegato al progetto Vercel');
  return { Authorization: 'Bearer ' + DB_TOK };
};

export async function loadCfg() {
  const r = await fetch(`${DB_URL}/get/${DB_KEY}`, { headers: dbAuth(), cache: 'no-store' });
  if (!r.ok) throw new Error('Errore lettura database Redis (HTTP ' + r.status + ')');
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : { s: [], mode: 'manual', n: 3 };
}

export async function saveCfg(cfg) {
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { ...dbAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', DB_KEY, JSON.stringify(cfg)]),
  });
  if (!r.ok) throw new Error('Salvataggio su Redis fallito (HTTP ' + r.status + ')');
}

export async function getCfg(q) {
  if (q.has('k')) {
    const cfg = await loadCfg();
    if (!cfg.k || cfg.k !== q.get('k')) throw new Error('Chiave non valida');
    return cfg;
  }
  if (q.has('c')) return decode(q.get('c'));
  throw new Error('Parametro k o c mancante');
}

// ---- Modifica canali (override per canale, hash URL stream) ----
export const uh = (url) => createHash('sha1').update(url).digest('hex').slice(0, 12);

function splitInf(inf) {
  let q = false;
  for (let i = 0; i < inf.length; i++) {
    if (inf[i] === '"') q = !q;
    else if (inf[i] === ',' && !q) return [inf.slice(0, i), inf.slice(i + 1)];
  }
  return [inf, ''];
}

const attr = (h, k) => (h.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`)) || [])[1] || '';

export function infParts(inf) {
  const [h, name] = splitInf(inf);
  return { name: name.trim(), id: attr(h, 'tvg-id'), logo: attr(h, 'tvg-logo') };
}

const setAttr = (h, k, v) => {
  const re = new RegExp(`(\\s)${k}="[^"]*"`);
  const kv = `${k}="${String(v).replace(/"/g, "'")}"`;
  return re.test(h) ? h.replace(re, (m, sp) => sp + kv) : h.replace(/^(#EXTINF:\S+)/, (m, d) => `${d} ${kv}`);
};

export function applyOv(inf, o) {
  if (!o) return inf;
  let [h, name] = splitInf(inf);
  if (o.i !== undefined) h = setAttr(h, 'tvg-id', o.i);
  if (o.l !== undefined) h = setAttr(h, 'tvg-logo', o.l);
  if (o.g !== undefined) h = setAttr(h, 'group-title', o.g);
  return h + ',' + (o.n !== undefined ? o.n : name);
}

// ---- Stato account Xtream ----
const stCache = new Map();

export async function xtStatus(s, fresh = false) {
  const key = `${cleanBase(s.u)}|${s.a}`;
  const hit = stCache.get(key);
  if (!fresh && hit && Date.now() - hit.t < 45000) return hit.v;

  const t0 = Date.now();
  let v;
  try {
    const r = await get(xtApiUrl(s), {}, 9000);
    const ms = Date.now() - t0;
    if (!r.ok) {
      v = { ok: false, state: 'offline', why: `HTTP ${r.status}`, ms };
    } else {
      const data = await r.json().catch(() => null);
      const u = data && data.user_info;
      if (!u || +u.auth !== 1) {
        v = { ok: false, state: 'disabled', why: 'credenziali non valide', ms };
      } else {
        const exp = +u.exp_date ? +u.exp_date * 1000 : null;
        const cons = +u.active_cons || 0;
        const max = u.max_connections === undefined || u.max_connections === null ? 1 : +u.max_connections;
        const st = String(u.status || 'Active').toLowerCase();

        v = { ok: true, state: 'online', exp, cons, max, ms };
        if (st !== 'active') {
          const map = { expired: 'scaduta', disabled: 'disattivata', banned: 'bloccata' };
          Object.assign(v, {
            ok: false,
            state: st === 'expired' ? 'expired' : 'disabled',
            why: map[st] || 'account ' + st,
          });
        } else if (exp && exp < Date.now()) {
          Object.assign(v, { ok: false, state: 'expired', why: 'scaduta' });
        } else if (max === 0 || cons >= max) {
          Object.assign(v, { ok: false, state: 'busy', why: 'occupata' });
        }
      }
    }
  } catch (e) {
    const ms = Date.now() - t0;
    v = {
      ok: false,
      state: 'offline',
      why: e && e.name === 'TimeoutError' ? 'timeout (>9s)' : 'offline / bloccata',
      ms,
    };
  }
  stCache.set(key, { t: Date.now(), v });
  return v;
}

// Selezione liste da includere nella playlist finale:
// - mode === 'manual': usa esattamente le liste spuntate (s.e !== 0)
// - mode === 'pool': tra le liste abilitate al pool (s.e !== 0), prende le prime N libere
export async function pickActive(cfg, fresh = false) {
  const all = (cfg.s || []).filter((s) => !s.t || s.t === 'xtream');
  const selected = all.filter((s) => s.e !== 0);
  const mode = cfg.mode === 'pool' ? 'pool' : 'manual';

  if (mode === 'manual') {
    return {
      mode,
      act: selected,
      skipped: [],
      notes: selected.length ? `manuale: ${selected.map((s) => s.n).join(', ')}` : 'nessuna lista selezionata',
    };
  }

  const limit = Math.max(1, +cfg.n || 3);
  const pool = selected.filter((s) => s.pl !== 0);
  if (!pool.length) {
    return { mode, act: [], skipped: [], notes: 'nessuna lista nel pool' };
  }

  const statuses = await Promise.all(pool.map((s) => xtStatus(s, fresh)));
  const act = [];
  const skipped = [];

  pool.forEach((s, i) => {
    const st = statuses[i];
    if (!st.ok) {
      skipped.push({ n: s.n, reason: st.why + (st.max ? ` (${st.cons}/${st.max})` : '') });
    } else if (act.length < limit) {
      act.push(s);
    } else {
      skipped.push({ n: s.n, reason: 'riserva (libera)' });
    }
  });

  return {
    mode,
    act,
    skipped,
    notes: `pool (${act.length}/${limit}): ${act.map((s) => s.n).join(', ') || 'nessuna'}` +
      (skipped.length ? ` | escluse: ${skipped.map((x) => `${x.n} (${x.reason})`).join(', ')}` : ''),
  };
}

// EPG automatici dalle liste Xtream attive
export async function epgUrls(cfg) {
  const { act } = await pickActive(cfg, false);
  return [...new Set(act.map((s) => xtEpgUrl(s)))];
}

// Test rapido di una lista Xtream (usato sul bottone Testa)
export async function testSource(s) {
  if (!s) return '❌ Nessuna lista da provare';
  const v = await xtStatus(s, true);
  const d = v.exp ? new Date(v.exp).toLocaleDateString('it-IT') : null;
  if (v.ok) {
    return `🟢 Libera (${v.cons}/${v.max} connessioni)${d ? ' · scade il ' + d : ''} · ${v.ms}ms`;
  }
  const icon = v.state === 'busy' ? '🟡' : '🔴';
  return `${icon} ${v.why}${d ? ' (scadenza ' + d + ')' : ''}${v.max ? ` · connessioni ${v.cons}/${v.max}` : ''} · ${v.ms}ms`;
}
