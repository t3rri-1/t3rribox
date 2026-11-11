import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { indexFilesEnabled } from '../lib/config.js';
import { openFile } from '../lib/github.js';
import { requestInfo, sendText } from '../lib/http.js';
import { isActiveContent, typeFor } from '../lib/mime.js';

const NAME = /^\d{6}\.[a-z0-9]{1,10}$/;
const LONG_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';

function notFound(req, res) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (String(req.headers.accept || '').includes('text/html')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    return res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>File not found</title><body style="font:18px system-ui;background:#0f1c22;color:#e8efed;padding:2rem">' +
        '<p>That file doesn\'t exist, or the link was mistyped.</p><p><a style="color:#e6b34f" href="/">Upload a file</a></p>',
    );
  }
  return sendText(res, 404, 'File not found', headers);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return sendText(res, 405, 'Method not allowed');
  }

  const { pathname, query } = requestInfo(req);
  const name = String(query.name || pathname.replace(/^\/+/, '')).toLowerCase();
  if (!NAME.test(name)) return notFound(req, res);
  const ext = name.split('.').pop();

  let upstream;
  try {
    upstream = await openFile(name, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      range: req.headers.range,
    });
  } catch {
    return sendText(res, 502, 'Storage is temporarily unavailable. Please try again.', { 'Cache-Control': 'no-store' });
  }

  if (upstream.status === 404) return notFound(req, res);
  if (upstream.status === 416) {
    res.statusCode = 416;
    res.setHeader('Content-Range', upstream.headers.get('content-range') || '');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  if (!upstream.ok) {
    console.error(`Upstream answered ${upstream.status} for ${name}`);
    return sendText(res, 502, 'Storage is temporarily unavailable. Please try again.', { 'Cache-Control': 'no-store' });
  }

  const partial = upstream.status === 206;
  res.statusCode = partial ? 206 : 200;
  // GitHub says text/plain for everything, so we set the real type from the extension.
  res.setHeader('Content-Type', typeFor(ext));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Disposition', `${query.download ? 'attachment' : 'inline'}; filename="${name}"`);
  // Pages and SVGs may not run scripts or submit forms from our domain.
  if (isActiveContent(ext)) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  }
  if (!indexFilesEnabled()) res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const length = upstream.headers.get('content-length');
  if (length && !upstream.headers.get('content-encoding')) res.setHeader('Content-Length', length);
  const range = upstream.headers.get('content-range');
  if (range) res.setHeader('Content-Range', range);
  // Files never change once uploaded, so the edge can keep them for a year.
  // Partial (Range) responses are never cached.
  res.setHeader('Cache-Control', partial ? 'no-store' : LONG_CACHE);

  if (req.method === 'HEAD' || !upstream.body) return res.end();
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('Streaming failed:', err?.message);
  }
}
