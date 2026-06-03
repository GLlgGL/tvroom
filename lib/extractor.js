// lib/extractor.js — resolve a tvroom video to its final m3u8 URL.
//
// CHAIN (no browser, no JWT forging):
//   1) GET tvroom.me/video/<slug>/<part>
//        -> <iframe src="player-v2.bcbc.red/player/v2/<playerJWT>">
//   2) GET that player URL
//        -> data-m3u8="https://player.bcbc.red/stream/m3u8/<streamJWT>"
//
// IMPORTANT (IP binding): the stream JWT embeds the IP of whoever fetched the
// player page. If you mint here on Vercel, the token is bound to VERCEL's IP,
// so the proxy (also on Vercel) can fetch the key/segments successfully. Always
// resolve and proxy from the same deployment, and play promptly (~5 min exp).

import {
  TVROOM_ORIGIN, PLAYER_ORIGIN, USER_AGENT, DEFAULT_PART, TIMEOUT_MS, log,
} from './constants.js'

async function http(url, init = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
        ...(init.headers || {}),
      },
      redirect: 'follow',
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export function pageUrlFrom(query) {
  const q = String(query || '').trim()
  if (!q) return null
  if (/^https?:\/\//i.test(q)) return q
  if (q.startsWith('/video/')) return `${TVROOM_ORIGIN}${q}`
  const slug = q.replace(/^\/+/, '')
  if (slug.includes('/')) return `${TVROOM_ORIGIN}/video/${slug}`
  return `${TVROOM_ORIGIN}/video/${slug}/${DEFAULT_PART}`
}

export function extractPlayerUrl(html) {
  let m = /<iframe[^>]+src=["']([^"']*player[-_]v2\.bcbc\.red\/player\/v2\/[^"']+)["']/i.exec(html)
  if (m) return m[1]
  m = /(https?:)?\/\/player[-_]v2\.bcbc\.red\/player\/v2\/[A-Za-z0-9._\-]+/i.exec(html)
  if (m) return m[0].startsWith('http') ? m[0] : `https:${m[0]}`
  return null
}

export function extractM3u8(html) {
  let m = /data-m3u8=["']([^"']+)["']/i.exec(html)
  if (m) return m[1]
  m = /https?:\/\/[^"'\s]*\/stream\/m3u8\/[A-Za-z0-9._\-]+/i.exec(html)
  return m ? m[0] : null
}

export function extractSubtitle(html) {
  const m = /data-(?:subtitle|vtt)=["']([^"']+\.(?:vtt|srt)[^"']*)["']/i.exec(html)
  return m ? m[1] : null
}

// query: full tvroom URL | /video/<slug>/<part> | <slug> | player URL
// -> { m3u8, sub, playerUrl } or null
export async function resolve(query) {
  const q = String(query || '')
  let playerUrl = null

  if (/player[-_]v2\.bcbc\.red\/player\/v2\//i.test(q)) {
    playerUrl = /^https?:/i.test(q) ? q : `https://${q.replace(/^\/+/, '')}`
  } else {
    const pageUrl = pageUrlFrom(q)
    if (!pageUrl) { log('no usable query'); return null }
    log('page:', pageUrl)
    const res = await http(pageUrl, { headers: { Referer: `${TVROOM_ORIGIN}/` } })
    if (!res.ok) { log(`page HTTP ${res.status}`); return null }
    playerUrl = extractPlayerUrl(await res.text())
    if (!playerUrl) { log('no player iframe found'); return null }
    if (playerUrl.startsWith('//')) playerUrl = `https:${playerUrl}`
  }

  log('player:', playerUrl)
  const pres = await http(playerUrl, { headers: { Referer: `${TVROOM_ORIGIN}/` } })
  if (!pres.ok) { log(`player HTTP ${pres.status}`); return null }
  const phtml = await pres.text()

  const m3u8 = extractM3u8(phtml)
  if (!m3u8) { log('no data-m3u8 in player page'); return null }
  const sub = extractSubtitle(phtml)
  log('m3u8:', m3u8)
  return { m3u8, sub, playerUrl }
}
