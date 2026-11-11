import { HttpError } from './http.js';

const bad = () => new HttpError(400, 'bad_multipart', 'The upload was malformed. Please try again.');

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function parseDisposition(value = '') {
  const name = /(?:^|[;\s])name="([^"]*)"/i.exec(value)?.[1] ?? /(?:^|[;\s])name=([^;]+)/i.exec(value)?.[1];
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1];
  const filename =
    star !== undefined
      ? safeDecode(star)
      : (/filename="([^"]*)"/i.exec(value)?.[1] ?? /filename=([^;]+)/i.exec(value)?.[1]);
  return { name, filename };
}

/**
 * Parses a multipart/form-data body held in a Buffer.
 * Returns [{ name, filename, contentType, data }]. `data` is a view into `body`.
 */
export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!m) throw bad();
  const boundary = m[1] || m[2];
  const opening = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`\r\n--${boundary}`);
  const parts = [];

  let pos = body.indexOf(opening);
  if (pos === -1) throw bad();
  pos += opening.length;

  while (pos < body.length) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // "--" after a boundary = end
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

    const headEnd = body.indexOf('\r\n\r\n', pos);
    if (headEnd === -1) throw bad();
    const headers = parseHeaders(body.toString('utf8', pos, headEnd));

    const start = headEnd + 4;
    const end = body.indexOf(closing, start);
    if (end === -1) throw bad();

    const { name, filename } = parseDisposition(headers['content-disposition']);
    parts.push({
      name,
      filename,
      contentType: headers['content-type'] || '',
      data: body.subarray(start, end),
    });
    pos = end + closing.length;
  }
  return parts;
}
