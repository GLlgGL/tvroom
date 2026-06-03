# TVRoom Vercel Proxy

A serverless Vercel proxy for TVRoom streams.

This project resolves a TVRoom video page into its final HLS stream URL, proxies all playlists, AES keys and segments through Vercel, removes the PNG wrapper used by the CDN, and decodes the obfuscated AES key required for playback.

The goal is to make the stream playable directly through a single proxied URL without requiring custom Referer or Origin headers in the player.

## Features

* Resolve TVRoom pages without a browser
* Extract player-v2.bcbc.red iframe
* Extract final player.bcbc.red HLS URL
* Proxy master playlists
* Proxy media playlists
* Rewrite all playlist URLs
* Rewrite AES key URLs
* Proxy segments
* Strip PNG-wrapped MPEG-TS segments
* Decode obfuscated AES-128 keys
* Works on Vercel Serverless Functions
* No Puppeteer required

## Project Structure

```text
tvroom-vercel/
├── package.json
├── api/
│   ├── resolve.js
│   └── hls.js
└── lib/
    ├── constants.js
    ├── extractor.js
    └── proxy.js
```

## How It Works

The stream chain looks like this:

```text
tvroom.me/video/...

    ↓

player-v2.bcbc.red/player/v2/<token>

    ↓

player.bcbc.red/stream/m3u8/<token>

    ↓

master playlist

    ↓

AES key + media playlists + segments
```

The resolver extracts the final m3u8 URL.

The proxy then rewrites every URL inside the playlist so that all requests continue to flow through Vercel.

This ensures:

* Referer is always correct
* Origin is always correct
* User-Agent is always correct
* Key requests work
* Segment requests work
* IP-bound tokens remain valid

## Installation

Clone the repository:

```bash
git clone https://github.com/yourname/tvroom-vercel.git
cd tvroom-vercel
```

Install dependencies:

```bash
npm install
```

## Deploying to Vercel

Install Vercel CLI:

```bash
npm install -g vercel
```

Login:

```bash
vercel login
```

Deploy:

```bash
vercel --prod
```

After deployment:

```text
https://your-project.vercel.app
```

Available endpoints:

```text
GET /api/resolve
GET /api/hls
```

## Resolving a Stream

Example:

```bash
curl "https://your-project.vercel.app/api/resolve?q=salmokji-2026"
```

Response:

```json
{
  "ok": true,
  "m3u8": "https://player.bcbc.red/stream/m3u8/...",
  "proxied": "https://your-project.vercel.app/api/hls?url=...",
  "sub": null
}
```

The value inside `proxied` is the URL you should play.

## Playing With MPV

Resolve first:

```bash
curl "https://your-project.vercel.app/api/resolve?q=salmokji-2026"
```

Copy the `proxied` value and play:

```bash
mpv "https://your-project.vercel.app/api/hls?url=..."
```

No Referer headers are needed.

No Origin headers are needed.

No User-Agent headers are needed.

The proxy injects them automatically.

## API

### Resolve Endpoint

```text
GET /api/resolve?q=<slug-or-url>
```

Accepted formats:

```text
salmokji-2026

/video/salmokji-2026/본편

https://tvroom.me/video/salmokji-2026/본편

https://player-v2.bcbc.red/player/v2/...
```

Returns:

```json
{
  "ok": true,
  "m3u8": "...",
  "proxied": "...",
  "sub": null
}
```

### HLS Proxy Endpoint

```text
GET /api/hls?url=<encoded-url>
```

Handles:

* Master playlists
* Media playlists
* AES keys
* MPEG-TS segments

## Environment Variables

Optional:

```bash
TVROOM_ORIGIN=https://tvroom.me

TVROOM_PLAYER_ORIGIN=https://player-v2.bcbc.red

TVROOM_UA=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0

TVROOM_DEFAULT_PART=본편

TVROOM_TIMEOUT_MS=20000

TVROOM_DEBUG=1
```

Add them through:

```text
Vercel Dashboard
→ Project Settings
→ Environment Variables
```

## Token Behaviour

The stream token is short-lived.

The stream token is also IP-bound.

Because of this:

```text
Resolve and playback should happen through the same Vercel deployment.
```

Do not resolve locally and then try to proxy from somewhere else.

Do not save tokens for later use.

Always call `/api/resolve` immediately before playback.

## Segment Handling

The CDN hides MPEG-TS data inside PNG files.

The proxy automatically:

1. Detects PNG payloads
2. Finds the end of the PNG container
3. Extracts the MPEG-TS stream
4. Returns valid video data

Without this step MPV typically reports:

```text
Video: png
Invalid data found when processing input
```

## AES Key Handling

The key endpoint does not return a raw AES key.

Instead it returns:

```text
base64(JSON)
```

The JSON contains:

```json
{
  "encrypted_key": "...",
  "rule": {...}
}
```

The proxy reconstructs the original 16-byte AES-128 key and returns it as raw binary data required by HLS players.

## Troubleshooting

### MPV Shows PNG Video

Usually means:

* key decoding failed
* segment dewrapping failed

Redeploy the latest proxy.

### 403 Errors

Usually means:

* token expired
* token IP mismatch

Resolve again and immediately play the returned URL.

### Stream Plays For A Few Minutes Then Stops

The upstream token expired.

Call `/api/resolve` again.

### No Stream Found

TVRoom page structure may have changed.

Enable:

```bash
TVROOM_DEBUG=1
```

and inspect Vercel logs.

## Example Workflow

```bash
curl "https://your-project.vercel.app/api/resolve?q=salmokji-2026"
```

Copy:

```json
{
  "proxied": "https://your-project.vercel.app/api/hls?url=..."
}
```

Then:

```bash
mpv "https://your-project.vercel.app/api/hls?url=..."
```

The stream should play without any additional headers or configuration.
