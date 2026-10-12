// GitHub serves every raw file as text/plain, so we set Content-Type ourselves.
// Order matters: the first extension listed for a type is used when we have to
// guess an extension from a Content-Type.
const TYPES = {
  // images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
  ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
  // video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v', '3gp': 'video/3gpp', ogv: 'video/ogg',
  // audio
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm', amr: 'audio/amr',
  // documents and text
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', md: 'text/markdown', rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip', ics: 'text/calendar', vcf: 'text/vcard',
  // archives and apps
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip', bz2: 'application/x-bzip2', xz: 'application/x-xz',
  apk: 'application/vnd.android.package-archive',
  // fonts and misc
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm',
  bin: 'application/octet-stream',
};

const REVERSE = {};
for (const [ext, type] of Object.entries(TYPES)) REVERSE[type] ??= ext;

const WITH_CHARSET = /^text\/|^application\/(json|xml|javascript)$|^image\/svg\+xml$/;

// Formats a browser would run as a page. We serve these with a locked-down CSP.
const ACTIVE = new Set(['html', 'htm', 'xhtml', 'svg', 'xml', 'xsl', 'xslt']);

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);

export function typeFor(ext) {
  const type = TYPES[String(ext).toLowerCase()] || 'application/octet-stream';
  return WITH_CHARSET.test(type) ? `${type}; charset=utf-8` : type;
}

export function extFor(mimetype) {
  const type = String(mimetype || '').split(';')[0].trim().toLowerCase();
  return REVERSE[type] || '';
}

export function isActiveContent(ext) {
  return ACTIVE.has(String(ext).toLowerCase());
}
