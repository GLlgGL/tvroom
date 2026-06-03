// lib/constants.js — shared config for the tvroom proxy.

export const TVROOM_ORIGIN = (process.env.TVROOM_ORIGIN || 'https://tvroom.me').replace(/\/+$/, '')

// The player iframe host (Referer/Origin the upstream m3u8/key/segment expect).
export const PLAYER_ORIGIN = process.env.TVROOM_PLAYER_ORIGIN || 'https://player-v2.bcbc.red'

// Stream UA. The JWT carries a `ua` claim (e.g. "Firefox(149.0)"); keep this a
// Firefox UA so the loose UA check passes.
export const USER_AGENT =
  process.env.TVROOM_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'

// Default "part" segment of a tvroom video path (Korean "main feature").
export const DEFAULT_PART = process.env.TVROOM_DEFAULT_PART || '본편'

export const TIMEOUT_MS = Number(process.env.TVROOM_TIMEOUT_MS || 20000)

// Headers used for ALL upstream requests (page, player, m3u8, key, segments).
export const UPSTREAM_HEADERS = {
  Referer: `${PLAYER_ORIGIN}/`,
  Origin: PLAYER_ORIGIN,
  'User-Agent': USER_AGENT,
}

export const DEBUG = !!process.env.TVROOM_DEBUG
export const log = (...a) => { if (DEBUG) console.error('[tvroom]', ...a) }
