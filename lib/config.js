import { HttpError, MB } from './http.js';

// Vercel rejects request bodies bigger than 4.5 MB, so bigger files travel in
// chunks of at most CHUNK_BYTES and are stitched together by /api/upload?complete=1.
export const SINGLE_REQUEST_BYTES = 4_000_000;
export const CHUNK_BYTES = 4_000_000;
export const CHUNK_HARD_LIMIT = 4_718_592; // 4.5 MiB, what Vercel allows
export const MAX_CHUNKS = 10;

const DEFAULT_BLOCKED = ['exe', 'scr', 'cpl', 'jar', 'bat', 'cmd', 'sh', 'doc', 'docm'];

export function maxBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * MB;
}

export function blockedExtensions() {
  const extra = (process.env.EXTRA_BLOCKED_EXTENSIONS || '')
    .split(',')
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_BLOCKED, ...extra]);
}

// true  = uploads are listed in sitemap.xml and may be indexed by search engines
// false = every served file carries "X-Robots-Tag: noindex" (default)
export function indexFilesEnabled() {
  return String(process.env.INDEX_FILES || '').toLowerCase() === 'true';
}

export function siteUrl(req) {
  const fromEnv = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return /^https?:\/\//i.test(fromEnv) ? fromEnv : `https://${fromEnv}`;
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : 'https://t3rribox.vercel.app';
}

export function github() {
  const token = (process.env.GITHUB_TOKEN || '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').trim();
  let repo = (process.env.GITHUB_REPO || '').trim();
  const owner = (process.env.GITHUB_OWNER || '').trim();
  if (owner && !repo.includes('/')) repo = `${owner}/${repo}`;
  const [repoOwner, repoName] = repo.split('/');
  if (!token || !repoOwner || !repoName) {
    console.error('Missing GITHUB_TOKEN or GITHUB_REPO (expected "owner/repo").');
    throw new HttpError(500, 'not_configured', 'The server is not set up yet. Please tell the site owner.');
  }
  return {
    token,
    owner: repoOwner,
    repo: repoName,
    branch: (process.env.GITHUB_BRANCH || 'main').trim(),
    apiUrl: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    rawUrl: (process.env.GITHUB_RAW_URL || 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
  };
}
