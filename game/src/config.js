/**
 * Where the realtime room lives.
 *
 * Vercel Functions are request/response and cannot hold a WebSocket open, so
 * the multiplayer state lives on a Cloudflare Worker (Durable Objects) while
 * the site itself stays on Vercel. Set PARTY_HOST to the host you get back
 * from `npx wrangler deploy` — hostname only, no scheme, no trailing slash.
 *
 * Leave it empty and the walkthrough runs single-player exactly as before —
 * that is the intended fallback, not a broken state.
 */

const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export const PARTY_HOST = isLocal
  ? '127.0.0.1:8787'                                  // npx wrangler dev
  : '';                                               // <-- paste deployed host

/** Everyone opening the same ?room= shares a visit. */
export const ROOM = new URLSearchParams(location.search).get('room') || 'balmoral';

export const MAX_PLAYERS = 6;
