import { sendJson } from '../lib/http.js';

export default function handler(req, res) {
  sendJson(res, 200, { ok: true }, { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
}
