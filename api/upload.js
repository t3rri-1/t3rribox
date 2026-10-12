import {
  CHUNK_BYTES,
  CHUNK_HARD_LIMIT,
  MAX_CHUNKS,
  SINGLE_REQUEST_BYTES,
  blockedExtensions,
  maxBytes,
  siteUrl,
} from '../lib/config.js';
import { HttpError, readBody, requestInfo, sendError, sendJson, setCors, mbText } from '../lib/http.js';
import { createBlob, getBlob } from '../lib/github.js';
import { typeFor } from '../lib/mime.js';
import { parseMultipart } from '../lib/multipart.js';
import { storeFile } from '../lib/storage.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MULTIPART_OVERHEAD = 1024 * 1024;

const decodeHeader = (value) => {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
};

function filenameFromDisposition(value = '') {
  return /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1]
    ? decodeHeader(/filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)[1])
    : (/filename="([^"]*)"/i.exec(value)?.[1] ?? /filename=([^;]+)/i.exec(value)?.[1] ?? '');
}

function parseJson(buffer, message) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (value && typeof value === 'object') return value;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'bad_json', message);
}

// Reads the file out of a normal (single request) upload.
async function readSingleUpload(req, query) {
  const limit = maxBytes();
  const contentType = String(req.headers['content-type'] || '');
  const kind = contentType.toLowerCase();

  if (kind.startsWith('multipart/form-data')) {
    const body = await readBody(req, limit + MULTIPART_OVERHEAD);
    const parts = parseMultipart(body, contentType);
    const part =
      parts.find((p) => p.name === 'file' && p.filename !== undefined) ||
      parts.find((p) => p.filename !== undefined) ||
      parts.find((p) => p.name === 'file');
    if (!part) throw new HttpError(400, 'no_file', 'No file found. Send it as the multipart field "file".');
    return {
      buffer: part.data,
      filename: part.filename || query.filename || '',
      mimetype: part.contentType,
    };
  }

  if (kind.startsWith('application/json')) {
    const body = await readBody(req, Math.ceil((limit * 4) / 3) + MULTIPART_OVERHEAD);
    const json = parseJson(body, 'The JSON body could not be read.');
    let data = json.base64 ?? json.data;
    if (typeof data !== 'string' || !data) {
      throw new HttpError(400, 'no_file', 'JSON uploads need a "base64" string and a "filename".');
    }
    let mimetype = String(json.mimetype || json.type || '');
    const prefix = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i.exec(data);
    if (prefix) {
      mimetype ||= prefix[1] || '';
      data = data.slice(prefix[0].length);
    }
    return {
      buffer: Buffer.from(data, 'base64'),
      filename: String(json.filename || json.name || query.filename || ''),
      mimetype,
    };
  }

  // Anything else is treated as the raw bytes of the file.
  const buffer = await readBody(req, limit);
  return {
    buffer,
    filename:
      query.filename ||
      decodeHeader(req.headers['x-filename']) ||
      filenameFromDisposition(String(req.headers['content-disposition'] || '')),
    mimetype: kind.split(';')[0].trim(),
  };
}

// Big files: the client sends parts of at most CHUNK_BYTES, each stored as an
// unreferenced Git blob, then calls ?complete=1 with the list of blob SHAs.
async function handleChunk(req, res) {
  const tooBig = `Each part must be ${mbText(CHUNK_HARD_LIMIT)} or smaller.`;
  const buffer = await readBody(req, CHUNK_HARD_LIMIT, tooBig);
  if (buffer.length === 0) throw new HttpError(400, 'empty_chunk', 'That part was empty.');
  const blob = await createBlob(buffer);
  sendJson(res, 200, { ok: true, blob, size: buffer.length }, NO_STORE);
}

async function assembleChunks(req) {
  const json = parseJson(await readBody(req, 64 * 1024), 'Send JSON like {"filename":"a.mp4","blobs":[...]}.');
  const { blobs } = json;
  const valid =
    Array.isArray(blobs) &&
    blobs.length > 0 &&
    blobs.length <= MAX_CHUNKS &&
    blobs.every((sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha));
  if (!valid) throw new HttpError(400, 'bad_chunks', `"blobs" must list 1 to ${MAX_CHUNKS} part IDs.`);

  const limit = maxBytes();
  let parts;
  try {
    parts = await Promise.all(blobs.map((sha) => getBlob(sha, CHUNK_HARD_LIMIT)));
  } catch (err) {
    if (err?.gh === 404) {
      throw new HttpError(400, 'bad_chunks', 'One of the uploaded parts is missing. Please upload the file again.');
    }
    throw err;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total > limit) throw new HttpError(413, 'too_large', `That file is too large. The limit is ${mbText(limit)}.`);

  return {
    buffer: Buffer.concat(parts, total),
    filename: String(json.filename || json.name || ''),
    mimetype: String(json.mimetype || json.type || ''),
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return sendJson(
      res,
      200,
      {
        ok: true,
        maxBytes: maxBytes(),
        singleRequestBytes: SINGLE_REQUEST_BYTES,
        chunkBytes: CHUNK_BYTES,
        maxChunks: MAX_CHUNKS,
        blockedExtensions: [...blockedExtensions()].sort(),
      },
      { 'Cache-Control': 'public, max-age=300' },
    );
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, POST, PUT, OPTIONS');
    return sendError(res, new HttpError(405, 'method_not_allowed', 'Use POST to upload a file.'));
  }

  try {
    const { query } = requestInfo(req);
    if (query.chunk) return await handleChunk(req, res);

    const file = query.complete ? await assembleChunks(req) : await readSingleUpload(req, query);
    const stored = await storeFile(file);

    const url = `${siteUrl(req)}/${stored.name}`;
    return sendJson(
      res,
      stored.duplicate ? 200 : 201,
      {
        ok: true,
        url,
        id: stored.id,
        name: stored.name,
        ext: stored.ext,
        type: typeFor(stored.ext).split(';')[0],
        size: stored.size,
        sha256: stored.hash,
        duplicate: stored.duplicate,
      },
      { ...NO_STORE, Location: url },
    );
  } catch (err) {
    return sendError(res, err);
  }
}
