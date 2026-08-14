/**
 * Realtime connection to the walkthrough room.
 *
 * A plain WebSocket with reconnect, rather than a client SDK: the game has no
 * build step, so a few dozen lines here beats introducing a bundler.
 *
 * Everything is best-effort. If the room is unreachable the walkthrough runs
 * exactly as it did single-player — being alone is the fallback, never an error
 * screen.
 */

const SEND_HZ = 12;          // pose updates per second
const RECONNECT_MS = 2000;

export class Net {
  /**
   * @param {string} host  partykit host, e.g. "balmoral-walkthrough.you.partykit.dev"
   *                       or "127.0.0.1:1999" in dev. Empty disables networking.
   * @param {string} room  room name; everyone on the same one shares a visit.
   */
  constructor(host, room = 'main') {
    this.host = host;
    this.room = room;
    this.ws = null;
    this.selfId = null;
    this.enabled = !!host;
    this.connected = false;
    this.full = false;

    this.onJoin = null;      // (player)
    this.onLeave = null;     // (id)
    this.onPose = null;      // (id, pose)
    this.onStatus = null;    // (text)

    this._identity = null;
    this._lastSend = 0;
    this._closing = false;
  }

  connect(name, avatar, pose) {
    if (!this.enabled) { this.onStatus?.('solo'); return; }
    this._identity = { name, avatar, pose };
    this._open();
  }

  _open() {
    const scheme = /^(localhost|127\.0\.0\.1)/.test(this.host) ? 'ws' : 'wss';
    const url = `${scheme}://${this.host}/room/${encodeURIComponent(this.room)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this._retry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.onStatus?.('connected');
      ws.send(JSON.stringify({ t: 'hello', ...this._identity }));
    };

    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          this.selfId = m.you;
          for (const p of m.players) this.onJoin?.(p);
          this.onStatus?.(`${m.players.length + 1} here`);
          break;
        case 'join':
          this.onJoin?.(m.player);
          break;
        case 'leave':
          this.onLeave?.(m.id);
          break;
        case 'pose':
          this.onPose?.(m.id, m.pose);
          break;
        case 'full':
          this.full = true;
          this._closing = true;
          this.onStatus?.(`room full (${m.max})`);
          break;
      }
    };

    ws.onclose = () => {
      this.connected = false;
      if (!this._closing) { this.onStatus?.('reconnecting'); this._retry(); }
    };
    ws.onerror = () => { /* onclose follows; nothing useful to add */ };
  }

  _retry() {
    if (this._closing) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._open(), RECONNECT_MS);
  }

  /** Throttled to SEND_HZ; call it every frame. */
  sendPose(position, yaw) {
    if (!this.connected) return;
    const now = performance.now();
    if (now - this._lastSend < 1000 / SEND_HZ) return;
    this._lastSend = now;
    this.ws.send(JSON.stringify({
      t: 'pose',
      pose: {
        p: [+position.x.toFixed(3), +position.y.toFixed(3), +position.z.toFixed(3)],
        y: +yaw.toFixed(3),
      },
    }));
  }

  close() {
    this._closing = true;
    clearTimeout(this._timer);
    try { this.ws?.close(); } catch { /* already gone */ }
  }
}
