import crypto from 'node:crypto';
import { HttpError, mbText } from './http.js';
import { maxBytes, blockedExtensions } from './config.js';
import { extFor } from './mime.js';
import { clearIndexCache, readIndex, saveIndex, putFile } from './github.js';

export const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt) => sleep(150 * 2 ** attempt + Math.random() * 250);

// "photo.JPG" -> "jpg". With no usable extension we fall back to the
// Content-Type, then to "bin".
export function pickExtension(filename = '', mimetype = '') {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(filename).trim());
  return (match ? match[1].toLowerCase() : '') || extFor(mimetype) || 'bin';
}

function newId(used) {
  for (let i = 0; i < 50; i++) {
    const id = String(crypto.randomInt(100000, 1000000));
    if (!used.has(id)) return id;
  }
  throw new HttpError(503, 'busy', 'Could not find a free link. Please try again.');
}

const idsIn = (index) => new Set(Object.values(index).map((name) => String(name).split('.')[0]));
const isConflict = (err) => err?.gh === 409 || err?.gh === 422;

/**
 * Stores a file and returns { name, id, ext, hash, size, duplicate }.
 * Same bytes uploaded twice always give back the same link.
 */
export async function storeFile({ buffer, filename = '', mimetype = '' }) {
  const limit = maxBytes();
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'empty_file', 'That file is empty.');
  if (buffer.length > limit) {
    throw new HttpError(413, 'too_large', `That file is too large. The limit is ${mbText(limit)}.`);
  }
  const ext = pickExtension(filename, mimetype);
  if (blockedExtensions().has(ext)) {
    throw new HttpError(400, 'blocked_type', `.${ext} files aren't allowed.`);
  }

  const hash = sha256(buffer);
  const result = (name, duplicate) => ({
    name,
    id: name.split('.')[0],
    ext: name.split('.').pop(),
    hash,
    size: buffer.length,
    duplicate,
  });

  // 1. Have we seen these exact bytes before?
  let { index, sha: indexSha } = await readIndex();
  if (index[hash]) return result(index[hash], true);

  // 2. Commit the file under a fresh 6-digit ID.
  const used = idsIn(index);
  let name;
  for (let attempt = 0; ; attempt++) {
    const id = newId(used);
    name = `${id}.${ext}`;
    try {
      await putFile(name, buffer, `upload ${name}`);
      break;
    } catch (err) {
      if (attempt >= 5 || !isConflict(err)) throw err;
      used.add(id); // 422 means that ID already exists; 409 is a branch race. Try again.
      await backoff(attempt);
    }
  }

  // 3. Record it in the index. On a conflict, re-read and merge so parallel
  //    uploads never overwrite each other. The file is already stored at this
  //    point, so if the index can't be updated we still return the working link.
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {
        await backoff(attempt);
        ({ index, sha: indexSha } = await readIndex());
        if (index[hash]) return result(index[hash], true); // another upload won the race
      }
      index[hash] = name;
      try {
        await saveIndex(index, indexSha, `index ${name}`);
        clearIndexCache();
        return result(name, false);
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }
    console.error(`Stored ${name} but the index kept conflicting; it will be missing from _index.json.`);
  } catch (err) {
    console.error(`Stored ${name} but could not update _index.json:`, err?.message);
  }
  return result(name, false);
}
