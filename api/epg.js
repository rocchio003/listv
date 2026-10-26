import { once } from 'node:events';
import { getCfg, epgUrls, getLong } from './_lib.js';

export const config = { maxDuration: 60 };

// Scarica un XMLTV (anche .gz) e ne scrive il contenuto senza <tv>…</tv>, in streaming
async function pipeEpg(url, w, onStart) {
  const r = await getLong(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rd = r.body.getReader();
  const first = await rd.read();
  let s = new ReadableStream({
    start(c) {
      if (first.value) c.enqueue(first.value);
      if (first.done) c.close();
    },
    async pull(c) {
      const x = await rd.read();
      x.done ? c.close() : c.enqueue(x.value);
    },
  });
  const v = first.value;
  if (v && v[0] === 0x1f && v[1] === 0x8b) s = s.pipeThrough(new DecompressionStream('gzip'));
  let st = false, buf = '', hold = '';
  for await (const chunk of s.pipeThrough(new TextDecoderStream())) {
    if (!st) {
      buf += chunk;
      const m = buf.match(/<tv(\s[^>]*)?>/);
      if (!m) {
        if (buf.length > 2e6) throw new Error('non è un XMLTV');
        continue;
      }
      st = true;
      onStart();
      hold = buf.slice(m.index + m[0].length);
      buf = '';
    } else {
      hold += chunk;
    }
    if (hold.length > 16) {
      await w(hold.slice(0, -16));
      hold = hold.slice(-16);
    }
  }
  if (!st) throw new Error('XMLTV non valido');
  await w(hold.replace(/<\/tv>\s*$/, ''));
}

export default async function handler(req, res) {
  const q = new URL(req.url, `https://${req.headers.host}`).searchParams;
  let cfg;
  try {
    cfg = await getCfg(q);
  } catch {
    return res.status(400).send('Link non valido');
  }
  const urls = await epgUrls(cfg);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  const w = async (x) => {
    if (x && !res.write(x)) await once(res, 'drain');
  };
  await w('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="IPTV Hub">\n');
  for (const url of urls) {
    let started = false;
    try {
      await pipeEpg(url, w, () => (started = true));
    } catch (e) {
      if (started) break; // flusso interrotto a metà: chiudiamo qui
      await w(`<!-- ERRORE ${url.replace(/[?#].*$/, '')}: ${String(e.message).replace(/--/g, '-')} -->\n`);
    }
  }
  await w('</tv>\n');
  res.end();
}
