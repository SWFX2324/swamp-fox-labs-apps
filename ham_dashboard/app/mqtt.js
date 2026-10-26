'use strict';
// Minimal MQTT 3.1.1 client: CONNECT (with a will message), QoS 0 PUBLISH
// (optionally retained), PINGREQ keepalive and automatic reconnect. That's
// all Home Assistant discovery needs; it never subscribes.

const net = require('net');
const tls = require('tls');

const KEEPALIVE_S = 60;

function str(s) {
  const b = Buffer.from(String(s), 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function remainingLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

const packet = (header, body) => Buffer.concat([Buffer.from([header]), remainingLength(body.length), body]);

const CONNACK_ERRORS = {
  1: 'unacceptable protocol version', 2: 'client ID rejected', 3: 'server unavailable',
  4: 'bad username or password', 5: 'not authorized',
};

class MqttClient {
  // opts: { host, port, ssl, username, password, clientId, will: { topic, payload, retain }, retry }
  // Reconnects with backoff unless retry is false. start() reports only the first attempt.
  constructor(opts) {
    this.opts = opts;
    this.connected = false;
    this.error = null;
    this.onConnect = null;
    this.retryMs = 5000;
    this.closing = false;
  }

  // Resolves on the first successful CONNACK, rejects if the first attempt fails.
  start() {
    return new Promise((resolve, reject) => {
      this.firstResult = { resolve, reject };
      this.connect();
    });
  }

  connect() {
    const { host, port, ssl } = this.opts;
    // A TLS broker must present a certificate valid for host; a self-signed one
    // fails, with the reason in the app's log and status.
    const sock = ssl
      ? tls.connect({ host, port: +port })
      : net.connect(+port, host);
    this.sock = sock;
    let buf = Buffer.alloc(0);
    let lastRx = Date.now();

    sock.on(ssl ? 'secureConnect' : 'connect', () => sock.write(this.connectPacket()));
    sock.on('data', chunk => {
      lastRx = Date.now();
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        // Decode the remaining-length varint to know the packet size.
        let len = 0, mult = 1, i = 1, byte;
        do {
          if (i >= buf.length) return;
          byte = buf[i++];
          len += (byte & 0x7f) * mult;
          mult *= 128;
        } while (byte & 0x80);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, body = buf.subarray(i, i + len);
        buf = buf.subarray(i + len);
        if (type === 2) this.connack(body[1]); // CONNACK
        // PINGRESP (13) and anything else need no action.
      }
    });
    const ping = setInterval(() => {
      if (Date.now() - lastRx > KEEPALIVE_S * 1500) sock.destroy(new Error('broker stopped responding'));
      else if (this.connected) sock.write(Buffer.from([0xc0, 0x00]));
    }, (KEEPALIVE_S / 2) * 1000);
    sock.on('error', err => { this.error = err.message; });
    sock.on('close', () => {
      clearInterval(ping);
      const was = this.connected;
      this.connected = false;
      if (this.firstResult) { this.firstResult.reject(new Error(this.error || 'connection closed')); this.firstResult = null; }
      if (this.closing || this.opts.retry === false) return;
      if (was) console.warn(`[mqtt] disconnected (${this.error || 'closed'}), retry in ${this.retryMs / 1000}s`);
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5 * 60_000);
    });
  }

  connectPacket() {
    const { clientId, username, password, will } = this.opts;
    let flags = 0x02; // clean session
    const payload = [str(clientId)];
    if (will) { flags |= 0x04 | (will.retain ? 0x20 : 0); payload.push(str(will.topic), str(will.payload)); }
    if (username) { flags |= 0x80; payload.push(str(username)); }
    if (username && password) { flags |= 0x40; payload.push(str(password)); }
    const keepalive = Buffer.alloc(2);
    keepalive.writeUInt16BE(KEEPALIVE_S);
    return packet(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, flags]), keepalive, ...payload]));
  }

  connack(code) {
    if (code !== 0) {
      this.error = `broker refused connection: ${CONNACK_ERRORS[code] || `code ${code}`}`;
      this.sock.destroy();
      return;
    }
    this.connected = true;
    this.error = null;
    this.retryMs = 5000;
    if (this.firstResult) { this.firstResult.resolve(); this.firstResult = null; }
    this.onConnect?.();
  }

  // QoS 0. Returns false if not connected (callers republish on reconnect).
  publish(topic, payload, { retain = false } = {}) {
    if (!this.connected) return false;
    const body = Buffer.concat([str(topic), Buffer.from(String(payload), 'utf8')]);
    this.sock.write(packet(0x30 | (retain ? 1 : 0), body));
    return true;
  }

  end() {
    this.closing = true;
    if (this.connected) this.sock.end(Buffer.from([0xe0, 0x00]));
    else this.sock?.destroy();
  }
}

module.exports = { MqttClient };
