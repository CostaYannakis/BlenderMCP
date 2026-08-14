/**
 * Balmoral walkthrough - realtime room, on Cloudflare Workers + Durable Objects.
 *
 * One Durable Object instance per room name, so everyone opening the same link
 * lands in the same object and sees each other. No accounts: you send a name
 * and an avatar choice on arrival and that is your identity for the session.
 *
 * This replaces the PartyKit version - PartyKit's hosted platform no longer
 * accepts new deployments (its shared partykit.dev zone is at Cloudflare's
 * 10,000 custom-domain limit). PartyKit was Durable Objects underneath anyway,
 * so this is the same thing without the middleman, and the browser client is
 * unchanged because both are just WebSockets.
 *
 * Deploy:  npx wrangler deploy
 * Dev:     npx wrangler dev
 */

const MAX_PLAYERS = 6;

export class Room {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();          // ws -> has .meta once they say hello
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.accept(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  accept(ws) {
    ws.accept();
    ws.meta = null;                    // set on hello
    ws.id = crypto.randomUUID();

    if (this.count() >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
      try { ws.close(4001, 'room full'); } catch { /* already closing */ }
      return;
    }
    this.sockets.add(ws);

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.onMessage(ws, msg);
    });
    const bye = () => this.drop(ws);
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);
  }

  /** Only sockets that have introduced themselves count as players. */
  count() {
    let n = 0;
    for (const s of this.sockets) if (s.meta) n++;
    return n;
  }

  onMessage(ws, msg) {
    if (msg.t === 'hello') {
      if (this.count() >= MAX_PLAYERS && !ws.meta) {
        ws.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
        try { ws.close(4001, 'room full'); } catch { /* already closing */ }
        return;
      }
      ws.meta = {
        id: ws.id,
        name: String(msg.name || 'guest').slice(0, 18),
        avatar: Number.isInteger(msg.avatar) ? msg.avatar : 0,
        pose: msg.pose || { p: [0, 0, 0], y: 0 },
      };

      const others = [];
      for (const s of this.sockets) if (s !== ws && s.meta) others.push(s.meta);

      ws.send(JSON.stringify({ t: 'welcome', you: ws.id, players: others }));
      this.broadcast({ t: 'join', player: ws.meta }, ws);
      return;
    }

    if (msg.t === 'pose') {
      if (!ws.meta) return;
      ws.meta.pose = msg.pose;
      // Six players at 12 Hz is a few kB/s of fan-out; nothing to gain by batching.
      this.broadcast({ t: 'pose', id: ws.id, pose: msg.pose }, ws);
      return;
    }

    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', at: msg.at }));
    }
  }

  drop(ws) {
    if (!this.sockets.delete(ws)) return;
    if (ws.meta) this.broadcast({ t: 'leave', id: ws.id }, ws);
  }

  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const s of this.sockets) {
      if (s === except) continue;
      try { s.send(data); } catch { this.sockets.delete(s); }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'access-control-allow-origin': '*' } });
    }
    // Last path segment is the room name: /room/<name>
    const room = url.pathname.split('/').filter(Boolean).pop() || 'balmoral';
    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(request);
  },
};
