import { readFile } from 'node:fs/promises';
import {
  CHUNK_BYTES,
  MAX_CHUNKS,
  SINGLE_REQUEST_BYTES,
  blockedExtensions,
  maxBytes,
  siteUrl,
} from '../lib/config.js';
import { MB, requestInfo, sendText } from '../lib/http.js';

const PAGES = { home: '/', docs: '/docs' };
const templates = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

async function template(name) {
  if (!templates.has(name)) {
    templates.set(name, await readFile(new URL(`../views/${name}.html`, import.meta.url), 'utf8'));
  }
  return templates.get(name);
}

// GOOGLE_SITE_VERIFICATION takes the token from Search Console's "HTML tag" option.
// Pasting the whole <meta> tag also works, and several tokens can be comma-separated.
function googleMeta() {
  return (process.env.GOOGLE_SITE_VERIFICATION || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => /content=["']([^"']+)["']/i.exec(value)?.[1] || value)
    .map((token) => `<meta name="google-site-verification" content="${esc(token)}">`)
    .join('\n  ');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(res, 405, 'Method not allowed');
  }

  const { pathname, query } = requestInfo(req);
  const key = query.p || (pathname.replace(/\/+$/, '') === '/docs' ? 'docs' : 'home');
  if (!PAGES[key]) return sendText(res, 404, 'Not found');

  const base = siteUrl(req);
  const blocked = [...blockedExtensions()].sort();
  const vars = {
    SITE_URL: esc(base),
    SITE_URL_JSON: jsonForScript(base).slice(1, -1),
    CANONICAL: esc(base + PAGES[key]),
    GOOGLE_META: googleMeta(),
    MAX_MB: esc(maxBytes() / MB),
    BLOCKED_LIST: esc(blocked.map((e) => `.${e}`).join(', ')),
    CHUNK_BYTES: String(CHUNK_BYTES),
    MAX_CHUNKS: String(MAX_CHUNKS),
    SINGLE_MB: esc(SINGLE_REQUEST_BYTES / 1_000_000),
    CONFIG_JSON: jsonForScript({
      maxBytes: maxBytes(),
      singleBytes: SINGLE_REQUEST_BYTES,
      chunkBytes: CHUNK_BYTES,
      blocked,
    }),
  };

  const html = (await template(key)).replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.end(req.method === 'HEAD' ? undefined : html);
}
