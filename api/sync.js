import { loadCfg, saveCfg } from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  
  // GET: Carica configurazione con chiave
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
  
  // POST: Salva configurazione con chiave
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const key = body.k;
      const cfg = body.cfg;
      
      if (!key || !cfg) {
        return res.status(400).send('Dati mancanti');
      }
      
      // Carica configurazione esistente o crea nuova
      let dbCfg;
      try {
        dbCfg = await loadCfg();
      } catch {
        dbCfg = { s: [], g: [] };
      }
      
      // Se la chiave non esiste ancora, la impostiamo
      if (!dbCfg.k) {
        dbCfg.k = key;
      } else if (dbCfg.k !== key) {
        return res.status(403).send('Chiave non corrispondente');
      }
      
      // Aggiorna dati
      dbCfg.s = cfg.s || [];
      dbCfg.g = cfg.g || [];
      
      await saveCfg(dbCfg);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).send('Errore salvataggio: ' + e.message);
    }
  }
  
  return res.status(405).send('Metodo non consentito');
}
