import { indexFilesEnabled, siteUrl } from '../lib/config.js';
import { readIndexCached } from '../lib/github.js';
import { requestInfo, sendText } from '../lib/http.js';
import { IMAGE_EXTENSIONS } from '../lib/mime.js';

const MAX_SITEMAP_URLS = 50_000;
const PAGES = ['/', '/docs'];

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// GOOGLE_VERIFICATION_FILE may hold one or more names ("google1a2b.html" or just "google1a2b").
function verificationFiles() {
  return (process.env.GOOGLE_VERIFICATION_FILE || '')
    .split(',')
    .map((s) => s.trim().replace(/^\/+/, '').toLowerCase())
    .filter(Boolean)
    .map((s) => (s.endsWith('.html') ? s : `${s}.html`));
}

async function uploadedNames() {
  if (!indexFilesEnabled()) return [];
  try {
    const { index } = await readIndexCached(300_000);
    return Object.values(index).slice(-(MAX_SITEMAP_URLS - PAGES.length)).reverse();
  } catch (err) {
    console.error('Sitemap: could not read the index, listing pages only:', err?.message);
    return [];
  }
}

function buildSitemap(base, names) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ];
  for (const path of PAGES) lines.push(`  <url><loc>${xml(base + path)}</loc></url>`);
  for (const name of names) {
    const loc = xml(`${base}/${name}`);
    const image = IMAGE_EXTENSIONS.has(name.split('.').pop())
      ? `<image:image><image:loc>${loc}</image:loc></image:image>`
      : '';
    lines.push(`  <url><loc>${loc}</loc>${image}</url>`);
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(res, 405, 'Method not allowed');
  }

  const { pathname, query } = requestInfo(req);
  const kind =
    query.f || (pathname.endsWith('sitemap.xml') ? 'sitemap' : pathname.endsWith('robots.txt') ? 'robots' : 'google');
  const base = siteUrl(req);

  if (kind === 'robots') {
    const body = ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
    return sendText(res, 200, body, { 'Cache-Control': 'public, max-age=0, s-maxage=3600' });
  }

  if (kind === 'sitemap') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    return res.end(buildSitemap(base, await uploadedNames()));
  }

  // Google Search Console "HTML file" verification. We only answer for the exact
  // file name configured by the owner, so nobody else can claim this site.
  const wanted = String(query.file || pathname.replace(/^\/+/, '')).toLowerCase();
  if (wanted && verificationFiles().includes(wanted)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    return res.end(`google-site-verification: ${wanted}`);
  }
  return sendText(res, 404, 'Not found', { 'Cache-Control': 'no-store' });
}
