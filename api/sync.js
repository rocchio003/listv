import { loadCfg, saveCfg } from './_lib.js';

export const config = { maxDuration: 30 };

// Helper per parsare il body JSON in Node.js
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Funzione per leggere/scrivere configurazione per una chiave specifica
async function getUserCfg(key) {
  const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const DB_KEY = `iptvhub:user:${key}`; // Ogni utente ha la sua chiave
  
  if (!DB_URL || !DB_TOK) throw new Error('Database Redis non configurato');
  
  const r = await fetch(`${DB_URL}/get/${DB_KEY}`, { 
    headers: { Authorization: 'Bearer ' + DB_TOK } 
  });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}

async function saveUserCfg(key, cfg) {
  const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const DB_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const DB_KEY = `iptvhub:user:${key}`;
  
  if (!DB_URL || !DB_TOK) throw new Error('Database Redis non configurato');
  
  const r = await fetch(DB_URL, { 
    method: 'POST', 
    headers: { Authorization: 'Bearer ' + DB_TOK }, 
    body: JSON.stringify(['SET', DB_KEY, JSON.stringify(cfg)]) 
  });
  if (!r.ok) throw new Error('Salvataggio fallito');
}

export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  
  // GET: Carica configurazione per questa chiave
  if (req.method === 'GET') {
    const key = q.get('k');
    if (!key) return res.status(400).send('Chiave mancante');
    
    try {
      const cfg = await getUserCfg(key);
      if (!cfg) {
        return res.status(404).send('Nessuna configurazione trovata per questa chiave');
      }
      return res.json({ s: cfg.s || [], g: cfg.g || [] });
    } catch (e) {
      return res.status(500).send('Errore caricamento: ' + e.message);
    }
  }
  
  // POST: Salva configurazione per questa chiave
  if (req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const key = body.k;
      const cfg = body.cfg;
      
      if (!key || !cfg) {
        return res.status(400).send('Dati mancanti');
      }
      
      // Carica configurazione esistente per questa chiave (o crea nuova)
      let existingCfg;
      try {
        existingCfg = await getUserCfg(key);
      } catch {
        existingCfg = null;
      }
      
      // Prepara la configurazione da salvare
      const cfgToSave = {
        k: key,
        s: cfg.s || [],
        g: cfg.g || [],
        updatedAt: new Date().toISOString()
      };
      
      await saveUserCfg(key, cfgToSave);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).send('Errore salvataggio: ' + e.message);
    }
  }
  
  return res.status(405).send('Metodo non consentito');
}
