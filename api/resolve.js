// api/resolve.js — resolve a tvroom video to a PROXIED master playlist URL.
//
//   GET /api/resolve?q=<slug | /video/... | full tvroom url | player url>
//   -> { ok, m3u8, proxied, sub }
//
// `proxied` is the URL you hand to the player/Stremio: it points at /api/hls so
// the playlist, AES key, and segments all flow through this deployment. Because
// the token is minted HERE (on Vercel) and fetched HERE, the JWT's IP claim
// matches the proxy's egress IP. Tokens are short-lived (~5 min) and IP-bound,
// so resolve right before playback.

import { resolve } from '../lib/extractor.js'

function selfBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    const q = new URL(req.url, 'http://x').searchParams.get('q')
    if (!q) return res.status(400).json({ ok: false, error: 'missing q' })

    const r = await resolve(q)
    if (!r?.m3u8) return res.status(404).json({ ok: false, error: 'no stream found' })

    const base = selfBase(req)
    const proxied = `${base}/api/hls?url=${encodeURIComponent(r.m3u8)}`
    const sub = r.sub ? `${base}/api/hls?url=${encodeURIComponent(r.sub)}` : null

    res.setHeader('Cache-Control', 'no-cache')
    return res.status(200).json({ ok: true, m3u8: r.m3u8, proxied, sub })
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e.message || e) })
  }
}

export const config = { maxDuration: 30 }
