import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getCfg, epgUrls, getLong } from './_lib.js';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

export const config = { maxDuration: 60 };

async function fetchEpgContent(url) {
  try {
    const r = await getLong(url);
    if (!r.ok) return null;

    const buffer = await r.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const decompressed = await gunzip(buffer);
      return new TextDecoder('utf-8').decode(decompressed);
    }

    if (bytes.length > 1 && bytes[0] === 0x78 && [0x9c, 0x01, 0xda].includes(bytes[1])) {
      const decompressed = await inflate(buffer);
      return new TextDecoder('utf-8').decode(decompressed);
    }

    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

// Estrae solo il contenuto interno dentro <tv ...> ... </tv> senza usare regex pesanti in RAM
function extractTvInner(xml) {
  if (!xml) return '';
  const tvStart = xml.indexOf('<tv');
  if (tvStart === -1) return '';
  const openEnd = xml.indexOf('>', tvStart);
  if (openEnd === -1) return '';
  const tvEnd = xml.lastIndexOf('</tv>');
  if (tvEnd === -1 || tvEnd <= openEnd) return xml.slice(openEnd + 1);
  return xml.slice(openEnd + 1, tvEnd);
}

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || (req.headers.host && req.headers.host.startsWith('localhost') ? 'http' : 'https');
  const q = new URL(req.url, `${proto}://${req.headers.host}`).searchParams;

  let cfg;
  try {
    cfg = await getCfg(q);
  } catch (e) {
    return res.status(400).send('Link non valido: ' + (e.message || e));
  }

  const urls = await epgUrls(cfg);
  if (!urls.length) {
    return res.status(404).send('Nessuna lista Xtream attiva per l’EPG');
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n');

  try {
    // Scarica gli EPG delle liste Xtream in parallelo per evitare timeout sequenziali
    const docs = await Promise.all(urls.map((u) => fetchEpgContent(u)));
    for (const xml of docs) {
      const inner = extractTvInner(xml);
      if (inner) res.write(inner + '\n');
    }
  } finally {
    res.end('</tv>\n');
  }
}
