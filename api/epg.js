import { epgUrls, getLong } from './_lib.js';

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

// Funzione helper: legge la risposta e decomprime se è gzip
async function readXmlResponse(r) {
  const buffer = await r.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Magic number gzip: 0x1F 0x8B
  if (bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
    // È gzip, decomprimi
    const stream = new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  
  // Altrimenti è testo puro (UTF-8)
  return new TextDecoder('utf-8').decode(bytes);
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
    try {
      const r = await getLong(url);
      if (!r.ok) {
        activeStreams--;
        if (activeStreams === 0) res.end('</tv>\n');
        continue;
      }
      
      // Usa la funzione helper che gestisce sia gzip che testo puro
      const text = await readXmlResponse(r);
      
      // Estraiamo solo i blocchi <channel> e <programme>
      const channels = text.match(/<channel[\s\S]*?<\/channel>/gi) || [];
      const programmes = text.match(/<programme[\s\S]*?<\/programme>/gi) || [];
      
      for (const ch of channels) {
        res.write(ch + '\n');
      }
      for (const pr of programmes) {
        res.write(pr + '\n');
      }
    } catch (e) {
      console.error('EPG fetch error for', url, e);
    }
    
    activeStreams--;
    if (activeStreams === 0) {
      res.end('</tv>\n');
    }
  }
}
