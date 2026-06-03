// api/hls.js — the proxy endpoint.
//   GET /api/hls?url=<encoded upstream m3u8|key|segment url>
// Rewrites playlists, strips segment PNG wrappers, normalizes the AES key.

import { proxyHlsRequest } from '../lib/proxy.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    const url = new URL(req.url, 'http://x')
    const target = url.searchParams.get('url')
    if (!target) return res.status(400).send('missing url')
    if (!/^https?:\/\//i.test(target)) return res.status(400).send('bad url')

    const out = await proxyHlsRequest(target)
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
    // Buffer or string both fine for res.send / res.end
    return res.status(out.status).send(out.body)
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502)
      .send(String(e.message || e))
  }
}

// Increase if large segments time out on your plan.
export const config = { maxDuration: 30 }
