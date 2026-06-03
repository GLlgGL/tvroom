// lib/proxy.js — HLS proxy core for tvroom/player.bcbc.red.
//
// - Playlists: rewrite EVERY upstream URL (segments AND the #EXT-X-KEY URI)
//   back through /api/hls so the player never talks to the IP-bound upstream.
// - Segments: strip the fake-PNG wrapper down to the MPEG-TS sync byte.
// - Key: return EXACTLY 16 raw bytes. If the upstream returns a JSON wrapper
//   (e.g. {"encrypted_key": "..."}), we try to coerce it to 16 bytes; if it's
//   not obviously a raw/base64 16-byte key, we pass the raw bytes through and
//   log a warning (see note at bottom — that case needs the player's JS decrypt).

import { Buffer } from 'node:buffer'
import { UPSTREAM_HEADERS, log } from './constants.js'

const PROXY = '/api/hls'

// ---- segment de-wrapping ---------------------------------------------------
// vr-cdn/bcbc segments are real .ts bytes hidden behind a PNG header (and the
// files use fake .jpg/.html/.js extensions). Strip PNG up to IEND, else skip to
// the first MPEG-TS sync byte (0x47, repeats every 188 bytes).
export function stripSegmentPayload(buf) {
  if (buf.length < 4) return buf
  if (buf[0] === 0x47) return buf // already TS
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (!isPng) return buf
  const iend = buf.indexOf(Buffer.from('IEND'))
  if (iend >= 0 && iend + 8 <= buf.length) {
    const after = buf.subarray(iend + 8)
    if (after.length && after[0] === 0x47) return after
    // sometimes a few trailing bytes after IEND CRC; scan a little
    for (let i = 0; i < Math.min(after.length, 64); i++) {
      if (after[i] === 0x47 && i + 188 < after.length && after[i + 188] === 0x47) return after.subarray(i)
    }
    return after
  }
  for (let i = 0; i < Math.min(buf.length, 65536); i++) {
    if (buf[i] === 0x47 && i + 188 < buf.length && buf[i + 188] === 0x47) return buf.subarray(i)
  }
  return buf
}

// ---- playlist rewriting ----------------------------------------------------
export function rewriteM3u8(text, baseUrl) {
  const abs = (u) => `${PROXY}?url=${encodeURIComponent(new URL(u, baseUrl).href)}`
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        // tags that carry URI="..." (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP)
        if (/URI="/.test(t)) {
          return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${abs(u)}"`)
        }
        return line
      }
      return abs(t) // segment or child playlist
    })
    .join('\n')
}

// ---- AES-128 key normalization ---------------------------------------------
// HLS requires the key response to be EXACTLY 16 binary bytes. Handle:
//   - already 16 raw bytes      -> pass through
//   - base64 of 16 bytes        -> decode
//   - hex (32 chars) of 16 bytes-> decode
//   - JSON {key|encrypted_key}  -> decode that field if it yields 16 bytes
// If none yield 16 bytes, return the raw buffer and log (likely needs the
// player's client-side decrypt of `encrypted_key`).
export function normalizeKey(raw) {
  if (raw.length === 16) return raw

  const text = raw.toString('utf8').trim()

  // JSON wrapper?
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text)
      const cand = j.key || j.k || j.encrypted_key || j.encryptedKey
      if (typeof cand === 'string') {
        const dec = tryDecodeKey(cand)
        if (dec) return dec
        log('key: JSON field present but not a 16-byte key (needs client decrypt):', Object.keys(j).join(','))
      }
    } catch {}
  }

  // bare base64 / hex of 16 bytes?
  const dec = tryDecodeKey(text)
  if (dec) return dec

  log('key: could not normalize to 16 bytes (len=' + raw.length + '); passing raw through')
  return raw
}

function tryDecodeKey(s) {
  // hex
  if (/^[0-9a-fA-F]{32}$/.test(s)) return Buffer.from(s, 'hex')
  // base64 (standard or url-safe)
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const b = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64')
    if (b.length === 16) return b
  } catch {}
  return null
}

// ---- upstream fetch + dispatch ---------------------------------------------
async function fetchUpstream(url) {
  const res = await fetch(url, { headers: UPSTREAM_HEADERS, redirect: 'follow' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`upstream ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`)
    err.status = res.status
    throw err
  }
  return res
}

// Returns { status, headers, body } where body is string | Buffer.
export async function proxyHlsRequest(targetUrl) {
  const res = await fetchUpstream(targetUrl)
  const type = (res.headers.get('content-type') || '').toLowerCase()
  const path = new URL(targetUrl).pathname.toLowerCase()

  const isPlaylist = type.includes('mpegurl') || type.includes('m3u8') || path.endsWith('.m3u8')
  const isKey = path.includes('/stream/key/') || /[?&]key/.test(targetUrl)

  if (isPlaylist) {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body: rewriteM3u8(await res.text(), targetUrl),
    }
  }

  const raw = Buffer.from(await res.arrayBuffer())

  if (isKey) {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body: normalizeKey(raw),
    }
  }

  // segment
  return {
    status: 200,
    headers: {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: stripSegmentPayload(raw),
  }
}
