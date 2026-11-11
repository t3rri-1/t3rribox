import { HttpError, MB } from './http.js';
import { setting } from './settings.js';

export const SINGLE_REQUEST_BYTES = 4_000_000;
export const CHUNK_BYTES = 4_000_000;
export const CHUNK_HARD_LIMIT = 4_718_592;
export const MAX_CHUNKS = 10;

const DEFAULT_BLOCKED = ['exe', 'scr', 'cpl', 'jar', 'bat', 'cmd', 'sh', 'doc', 'docm'];

export function maxBytes() {
  const mb = Number(setting('MAX_UPLOAD_MB'));
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * MB;
}

export function blockedExtensions() {
  const extra = setting('EXTRA_BLOCKED_EXTENSIONS')
    .split(',')
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_BLOCKED, ...extra]);
}

export function indexFilesEnabled() {
  return String(setting('INDEX_FILES')).toLowerCase() === 'true';
}

export function siteUrl(req) {
  const fromSetting = setting('SITE_URL').trim().replace(/\/+$/, '');
  if (fromSetting) return /^https?:\/\//i.test(fromSetting) ? fromSetting : `https://${fromSetting}`;
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : 'https://t3rribox.vercel.app';
}

export function github() {
  const token = setting('GITHUB_TOKEN').trim();
  let repo = setting('GITHUB_REPO').trim();
  const owner = setting('GITHUB_OWNER').trim();
  if (owner && !repo.includes('/')) repo = `${owner}/${repo}`;
  const [repoOwner, repoName] = repo.split('/');
  if (!token || !repoOwner || !repoName) {
    console.error('Missing GITHUB_TOKEN or GITHUB_REPO. Edit lib/settings.js.');
    throw new HttpError(500, 'not_configured', 'The server is not set up yet. Please tell the site owner.');
  }
  return {
    token,
    owner: repoOwner,
    repo: repoName,
    branch: (setting('GITHUB_BRANCH') || 'main').trim(),
    apiUrl: (setting('GITHUB_API_URL') || 'https://api.github.com').replace(/\/+$/, ''),
    rawUrl: (setting('GITHUB_RAW_URL') || 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
  };
}