import { loadCfg, saveCfg } from './_lib.js';

export const config = { maxDuration: 30 };

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

export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  
  // GET: Carica configurazione
  if (req.method === 'GET') {
    const key = q.get('k');
    if (!key) return res.status(400).send('Chiave mancante');
    
    try {
      const cfg = await loadCfg();
      if (!cfg.k || cfg.k !== key) {
        return res.status(404).send('Chiave non valida');
      }
      return res.json({ s: cfg.s || [], g: cfg.g || [] });
    } catch (e) {
      return res.status(500).send('Errore caricamento: ' + e.message);
    }
  }
  
  // POST: Salva configurazione (sovrascrive sempre)
  if (req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const key = body.k;
      const cfg = body.cfg;
      
      if (!key || !cfg) {
        return res.status(400).send('Dati mancanti');
      }
      
      // Sovrascrive sempre con la nuova chiave e i nuovi dati
      const cfgToSave = {
        k: key,
        s: cfg.s || [],
        g: cfg.g || [],
        updatedAt: new Date().toISOString()
      };
      
      await saveCfg(cfgToSave);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).send('Errore salvataggio: ' + e.message);
    }
  }
  
  return res.status(405).send('Metodo non consentito');
}
