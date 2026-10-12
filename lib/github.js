import { github as cfg } from './config.js';
import { HttpError } from './http.js';

const API_VERSION = '2022-11-28';
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function niceWait(seconds) {
  if (seconds <= 90) return 'a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 120 ? 'a while' : `${minutes} minutes`;
}

async function request(path, { method = 'GET', body, accept } = {}) {
  const c = cfg();
  try {
    return await fetch(`${c.apiUrl}/repos/${c.owner}/${c.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 't3rribox',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    console.error('GitHub request failed:', err?.name, err?.message);
    throw new HttpError(502, 'storage_unreachable', "Couldn't reach GitHub. Please try again in a moment.");
  }
}

// Turns a failed GitHub response into a friendly HttpError. The upstream status
// is kept on err.gh so the storage layer can decide what to retry.
async function fail(res) {
  let message = '';
  try {
    message = (await res.json())?.message || '';
  } catch {
    /* body was not JSON */
  }
  console.error(`GitHub responded ${res.status}: ${message}`);

  const retryAfter = Number(res.headers.get('retry-after')) || 0;
  const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
  const limited =
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || retryAfter > 0 || /rate limit|abuse/i.test(message)));

  let err;
  if (limited) {
    const seconds = retryAfter || (reset ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60);
    err = new HttpError(
      429,
      'rate_limited',
      `GitHub is rate-limiting uploads right now. Please try again in ${niceWait(seconds)}.`,
      { retryAfter: seconds },
    );
  } else if (res.status === 401) {
    err = new HttpError(502, 'storage_auth', 'Storage login failed. The GitHub token is invalid or expired.');
  } else if (res.status === 403) {
    err = new HttpError(
      502,
      'storage_forbidden',
      'Storage access was denied. The GitHub token needs Contents: Read and write on the repo.',
    );
  } else if (res.status === 404) {
    err = new HttpError(
      502,
      'storage_not_found',
      "The storage repo or branch wasn't found. Check GITHUB_REPO and GITHUB_BRANCH.",
    );
  } else if (res.status === 409 && /empty/i.test(message)) {
    err = new HttpError(502, 'storage_empty', 'The storage repo is empty. Add a README to it first, then try again.');
  } else if (res.status === 409 || res.status === 422) {
    err = new HttpError(409, 'conflict', 'Another upload was saving at the same time. Please try again.');
  } else if (res.status >= 500) {
    err = new HttpError(502, 'storage_down', 'GitHub is having trouble right now. Please try again shortly.');
  } else {
    err = new HttpError(502, 'storage_error', `Storage returned an unexpected error (${res.status}).`);
  }
  err.gh = res.status;
  return err;
}

export async function getBlob(sha, limitBytes) {
  const res = await request(`/git/blobs/${sha}`);
  if (!res.ok) throw await fail(res);
  const declared = Number(res.headers.get('content-length')) || 0;
  if (limitBytes && declared > limitBytes * 1.4 + 4096) {
    res.body?.cancel?.();
    throw new HttpError(413, 'too_large', 'That upload is too large.');
  }
  const data = await res.json();
  return Buffer.from(data.content || '', data.encoding === 'base64' ? 'base64' : 'utf8');
}

export async function createBlob(buffer) {
  const res = await request('/git/blobs', {
    method: 'POST',
    body: { content: buffer.toString('base64'), encoding: 'base64' },
  });
  if (!res.ok) throw await fail(res);
  return (await res.json()).sha;
}

// _index.json maps SHA-256 hashes to filenames: { "<sha256>": "839201.jpg" }
export async function readIndex() {
  const c = cfg();
  const res = await request(`/contents/_index.json?ref=${encodeURIComponent(c.branch)}`, {
    accept: 'application/vnd.github.object+json',
  });
  if (res.status === 404) return { index: {}, sha: null };
  if (!res.ok) throw await fail(res);
  const data = await res.json();
  // Files over 1 MB come back without content, so fetch the blob instead.
  const buffer =
    data.encoding === 'base64' && data.content ? Buffer.from(data.content, 'base64') : await getBlob(data.sha);
  let index;
  try {
    index = JSON.parse(buffer.toString('utf8') || '{}');
  } catch {
    console.error('_index.json is not valid JSON');
    throw new HttpError(500, 'index_corrupt', 'The storage index is unreadable. Please tell the site owner.');
  }
  return { index, sha: data.sha };
}

export async function saveIndex(index, sha, message) {
  const c = cfg();
  const res = await request('/contents/_index.json', {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(JSON.stringify(index)).toString('base64'),
      branch: c.branch,
      ...(sha ? { sha } : {}),
    },
  });
  if (!res.ok) throw await fail(res);
  await res.json();
}

export async function putFile(name, buffer, message) {
  const c = cfg();
  const res = await request(`/contents/${encodePath(`files/${name}`)}`, {
    method: 'PUT',
    body: { message, content: buffer.toString('base64'), branch: c.branch },
  });
  if (!res.ok) throw await fail(res);
  await res.json();
}

// Short-lived cache for read-only endpoints (info, sitemap) so a flood of
// requests cannot burn through the GitHub API quota that uploads need.
let cached = { at: 0, value: null };
export function clearIndexCache() {
  cached = { at: 0, value: null };
}
export async function readIndexCached(ttlMs = 30_000) {
  if (cached.value && Date.now() - cached.at < ttlMs) return cached.value;
  const value = await readIndex();
  cached = { at: Date.now(), value };
  return value;
}

// Fetches a stored file from GitHub's raw URL (or the Contents API if
// GITHUB_RAW_VIA_API=true). Returns the upstream fetch Response.
export async function openFile(name, { method = 'GET', range } = {}) {
  const c = cfg();
  const headers = { 'User-Agent': 't3rribox', 'Accept-Encoding': 'identity' };
  if (range) headers.Range = range;

  let url;
  if (String(process.env.GITHUB_RAW_VIA_API).toLowerCase() === 'true') {
    url = `${c.apiUrl}/repos/${c.owner}/${c.repo}/contents/${encodePath(`files/${name}`)}?ref=${encodeURIComponent(c.branch)}`;
    headers.Authorization = `Bearer ${c.token}`;
    headers.Accept = 'application/vnd.github.raw+json';
    headers['X-GitHub-Api-Version'] = API_VERSION;
  } else {
    url = `${c.rawUrl}/${c.owner}/${c.repo}/${encodePath(c.branch)}/files/${name}`;
    headers.Authorization = `token ${c.token}`;
  }

  try {
    return await fetch(url, { method, headers, signal: AbortSignal.timeout(55_000) });
  } catch (err) {
    console.error('GitHub file fetch failed:', err?.name, err?.message);
    throw new HttpError(502, 'storage_unreachable', 'Storage is temporarily unavailable.');
  }
}
