import { getCfg, epgUrls, getLong } from './_lib.js';

export const config = { maxDuration: 60 };

async function getUserCfg(key) {
  const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const DB_KEY = 'iptvhub:cfg';
  
  if (!DB_URL || !DB_TOK) throw new Error('Database non configurato');
  
  const r = await fetch(`${DB_URL}/get/${DB_KEY}`, { 
    headers: { Authorization: 'Bearer ' + DB_TOK } 
  });
  const j = await r.json();
  if (!j.result) throw new Error('Nessuna configurazione salvata');
  
  const cfg = JSON.parse(j.result);
  if (!cfg.k || cfg.k !== key) throw new Error('Chiave non valida');
  return cfg;
}

async function getInlineCfg(token) {
  const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([b64d(token)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}

export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  let cfg;
  
  try {
    if (q.has('k')) {
      cfg = await getUserCfg(q.get('k'));
    } else if (q.has('c')) {
      cfg = await getInlineCfg(q.get('c'));
    } else {
      throw new Error('Parametro mancante');
    }
  } catch (e) {
    return res.status(400).send('Link non valido: ' + e.message);
  }

  const urls = await epgUrls(cfg);
  if (!urls.length) return res.status(404).send('Nessuna sorgente EPG configurata');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n');
  
  let closed = 0;
  const streams = urls.map((url) => getLong(url).then((r) => {
    if (!r.ok) return '';
    return r.body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
  }).catch(() => ''));

  for (const stream of streams) {
    const reader = (await stream).getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const parts = buffer.split('</channel>');
      for (let i = 0; i < parts.length - 1; i++) {
        res.write(parts[i] + '</channel>\n');
      }
      buffer = parts[parts.length - 1];
    }
    if (buffer.trim()) res.write(buffer + '\n');
    closed++;
    if (closed === streams.length) res.end('</tv>');
  }
}
