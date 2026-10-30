import { epgUrls, getLong } from './_lib.js';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

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

async function fetchEpgContent(url) {
  try {
    const r = await getLong(url);
    if (!r.ok) return null;
    
    const buffer = await r.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    // 1. Rileva GZIP (magic number: 1f 8b)
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const decompressed = await gunzip(buffer);
      return new TextDecoder('utf-8').decode(decompressed);
    }
    
    // 2. Rileva DEFLATE/ZLIB (magic number: 78 9c, 78 01, 78 da)
    if (bytes.length > 1 && bytes[0] === 0x78 && [0x9c, 0x01, 0xda].includes(bytes[1])) {
      const decompressed = await inflate(buffer);
      return new TextDecoder('utf-8').decode(decompressed);
    }
    
    // 3. Altrimenti è testo puro
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    console.error('Errore fetch EPG per', url, e);
    return null;
  }
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
  
  let activeStreams = urls.length;
  
  for (const url of urls) {
    const text = await fetchEpgContent(url);
    if (text) {
      const channels = text.match(/<channel[\s\S]*?<\/channel>/gi) || [];
      const programmes = text.match(/<programme[\s\S]*?<\/programme>/gi) || [];
      for (const ch of channels) res.write(ch + '\n');
      for (const pr of programmes) res.write(pr + '\n');
    }
    activeStreams--;
    if (activeStreams === 0) res.end('</tv>\n');
  }
}
