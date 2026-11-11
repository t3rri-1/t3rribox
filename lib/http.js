// Small helpers shared by every function. Plain Node req/res only, so nothing
// here depends on Vercel-specific helpers.

export const MB = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function mbText(bytes) {
  const mb = bytes / MB;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
  res.setHeader('Access-Control-Expose-Headers', 'Location, Retry-After');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(payload)));
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(payload);
}

export function sendError(res, err) {
  if (res.headersSent) {
    res.destroy?.();
    return;
  }
  if (!(err instanceof HttpError)) {
    console.error('Unhandled error:', err);
    err = new HttpError(500, 'server_error', 'Something went wrong on our side. Please try again.');
  }
  const headers = { 'Cache-Control': 'no-store' };
  if (err.extra?.retryAfter) headers['Retry-After'] = String(err.extra.retryAfter);
  sendJson(res, err.status, { ok: false, code: err.code, error: err.message }, headers);
}

export function sendText(res, status, text, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(text);
}

// Works whether Vercel hands us the original URL, the rewritten URL, or just
// req.query, by merging everything we can see.
export function requestInfo(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  for (const [key, value] of Object.entries(req.query || {})) {
    query[key] = Array.isArray(value) ? value[0] : value;
  }
  return { pathname: url.pathname, query };
}

export async function readBody(req, limit, tooLargeMessage) {
  const message = tooLargeMessage || `That upload is too large. The limit is ${mbText(limit)}.`;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) throw new HttpError(413, 'too_large', message);
  const parts = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new HttpError(413, 'too_large', message);
    parts.push(chunk);
  }
  return Buffer.concat(parts, total);
}
