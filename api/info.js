import { siteUrl } from '../lib/config.js';
import { HttpError, requestInfo, sendError, sendJson, setCors } from '../lib/http.js';
import { openFile, readIndexCached } from '../lib/github.js';
import { typeFor } from '../lib/mime.js';

// GET /api/info?id=839201      (also accepts 839201.jpg or the full link)
// GET /api/info?sha256=<hash>  (is this exact file already hosted?)
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return sendError(res, new HttpError(405, 'method_not_allowed', 'Use GET.'));
  }

  try {
    const { query } = requestInfo(req);
    const { index } = await readIndexCached();
    let hash = '';
    let name = '';

    if (query.sha256) {
      hash = String(query.sha256).trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, 'bad_hash', 'sha256 must be 64 hex characters.');
      name = index[hash] || '';
    } else {
      const wanted = String(query.id || query.name || '').trim().toLowerCase().replace(/^.*\//, '');
      const m = /^(\d{6})(?:\.([a-z0-9]{1,10}))?$/.exec(wanted);
      if (!m) throw new HttpError(400, 'bad_id', 'Pass id=839201 (or 839201.jpg) or sha256=<hash>.');
      for (const [h, n] of Object.entries(index)) {
        if (n.startsWith(`${m[1]}.`) && (!m[2] || n === `${m[1]}.${m[2]}`)) {
          hash = h;
          name = n;
          break;
        }
      }
    }
    if (!name) throw new HttpError(404, 'not_found', 'No file found.');

    const ext = name.split('.').pop();
    let size = null;
    try {
      const head = await openFile(name, { method: 'HEAD' });
      const length = Number(head.headers.get('content-length'));
      if (head.ok && length) size = length;
    } catch {
      /* size is best-effort */
    }

    return sendJson(
      res,
      200,
      {
        ok: true,
        id: name.split('.')[0],
        name,
        ext,
        type: typeFor(ext).split(';')[0],
        size,
        url: `${siteUrl(req)}/${name}`,
        sha256: hash,
      },
      { 'Cache-Control': 'public, max-age=60, s-maxage=3600' },
    );
  } catch (err) {
    return sendError(res, err);
  }
}
