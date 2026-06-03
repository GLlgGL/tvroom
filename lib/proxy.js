import { Buffer } from 'node:buffer'
import { UPSTREAM_HEADERS, log } from './constants.js'

const PROXY = '/api/hls'

export function rewriteM3u8(text, baseUrl) {
  const abs = (u) => `${PROXY}?url=${encodeURIComponent(new URL(u, baseUrl).href)}`

  return text.split('\n').map((line) => {
    const t = line.trim()
    if (!t) return line

    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${abs(u)}"`)
    }

    return abs(t)
  }).join('\n')
}

export function stripSegmentPayload(buf) {
  if (buf.length < 4) return buf
  if (buf[0] === 0x47) return buf

  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47

  if (!isPng) return buf

  const iend = buf.indexOf(Buffer.from('IEND'))
  if (iend >= 0 && iend + 8 <= buf.length) {
    const after = buf.subarray(iend + 8)
    for (let i = 0; i < Math.min(after.length, 2048); i++) {
      if (after[i] === 0x47 && i + 188 < after.length && after[i + 188] === 0x47) {
        return after.subarray(i)
      }
    }
    return after
  }

  for (let i = 0; i < Math.min(buf.length, 65536); i++) {
    if (buf[i] === 0x47 && i + 188 < buf.length && buf[i + 188] === 0x47) {
      return buf.subarray(i)
    }
  }

  return buf
}

function b64decode(s) {
  const fixed = String(s).trim().replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(fixed + '='.repeat((4 - fixed.length % 4) % 4), 'base64')
}

function tryJsonFromTextOrBase64(text) {
  try {
    return JSON.parse(text)
  } catch {}

  try {
    return JSON.parse(b64decode(text).toString('utf8'))
  } catch {}

  return null
}

function decodeNoisyKey(encryptedKey, rule) {
  const data = b64decode(encryptedKey)

  const sizes = rule?.segment_sizes || [4, 4, 4, 4]
  const noise = Number(rule?.noise_length ?? 2)
  const permutation = rule?.permutation || [0, 2, 1, 3]

  const parts = []
  let off = 0

  for (const size of sizes) {
    parts.push(data.subarray(off, off + size))
    off += size + noise
  }

  const ordered = new Array(parts.length)

  for (let i = 0; i < parts.length; i++) {
    ordered[permutation[i]] = parts[i]
  }

  const key = Buffer.concat(ordered)

  if (key.length !== 16) {
    throw new Error(`decoded key is ${key.length} bytes, expected 16`)
  }

  return key
}

export function normalizeKey(raw) {
  if (raw.length === 16) return raw

  const text = raw.toString('utf8').trim()

  const j = tryJsonFromTextOrBase64(text)

  if (j) {
    const enc = j.encrypted_key || j.encryptedKey
    if (enc && j.rule) {
      return decodeNoisyKey(enc, j.rule)
    }

    const plain = j.key || j.k
    if (plain) {
      const b = b64decode(plain)
      if (b.length === 16) return b
    }
  }

  if (/^[0-9a-fA-F]{32}$/.test(text)) {
    return Buffer.from(text, 'hex')
  }

  try {
    const b = b64decode(text)
    if (b.length === 16) return b
  } catch {}

  log('key failed normalize len=' + raw.length)
  return raw
}

async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: UPSTREAM_HEADERS,
    redirect: 'follow',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`upstream ${res.status}: ${body.slice(0, 160)}`)
    err.status = res.status
    throw err
  }

  return res
}

export async function proxyHlsRequest(targetUrl) {
  const res = await fetchUpstream(targetUrl)

  const type = (res.headers.get('content-type') || '').toLowerCase()
  const path = new URL(targetUrl).pathname.toLowerCase()

  const isPlaylist =
    type.includes('mpegurl') ||
    path.endsWith('.m3u8')

  const isKey =
    path.includes('/stream/key/')

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
