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

  // Raccogli tutti gli URL EPG unici
  const urls = new Set();
  
  // 1. Aggiungi gli EPG manuali (solo se attivi)
  if (cfg.g && Array.isArray(cfg.g)) {
    cfg.g.filter(g => g.e !== 0).forEach(g => {
      if (g.u) urls.add(g.u);
    });
  }

  // 2. Aggiungi automaticamente gli EPG dalle liste Xtream attive
  if (cfg.s && Array.isArray(cfg.s)) {
    for (const s of cfg.s) {
      if (s.e !== 0 && s.t === 'xtream' && s.u && s.a && s.p) {
        urls.add(`${s.u.replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(s.a)}&password=${encodeURIComponent(s.p)}`);
      }
    }
  }

  const urlArray = Array.from(urls);
  if (urlArray.length === 0) {
    return res.status(404).send('Nessuna sorgente EPG configurata o attiva');
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n');
  
  // Scarica e unisci i file XML
  for (const url of urlArray) {
    try {
      const r = await fetch(url, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 
        signal: AbortSignal.timeout(45000) 
      });
      
      if (!r.ok) continue;
      
      const text = await r.text();
      
      // Pulizia per evitare tag <tv> o <?xml> annidati che rompono il file finale
      let cleanXml = text
        .replace(/<\?xml[^>]*\?>/gi, '')
        .replace(/<tv[^>]*>/gi, '')
        .replace(/<\/tv>/gi, '')
        .trim();
        
      if (cleanXml) {
        res.write(cleanXml + '\n');
      }
    } catch (e) {
      console.error('Errore fetch EPG:', url, e.message);
    }
  }
  
  res.end('</tv>');
}
