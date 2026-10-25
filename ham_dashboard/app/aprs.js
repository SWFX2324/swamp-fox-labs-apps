'use strict';
// APRS-IS client and packet parser. Receive-only: logs in with passcode -1 and
// a range filter, then keeps the latest state of every station heard nearby.
// Parses uncompressed, compressed and Mic-E positions, objects, items,
// weather (with and without position), status and third-party packets.

const net = require('net');

const MIN = 60_000;
const KNOT_KMH = 1.852;
const FT_M = 0.3048;
const STATION_TTL = 3 * 60 * MIN;
const TRACK_POINTS = 40;

// ---------------------------------------------------------------- parsing

const b91 = s => [...s].reduce((v, ch) => v * 91 + ch.charCodeAt(0) - 33, 0);
const validPos = p => p && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0);

// The primary table is '/'; '\' and overlay characters (A-Z, 0-9) select the
// alternate table. Keep the overlay so the UI can show it.
function symbolOf(table, code) {
  return { symbol: (table === '/' ? '/' : '\\') + code, overlay: /[A-Z0-9]/.test(table) ? table : '' };
}

// DDMM.mmN/DDDMM.mmW$ - spaces mean position ambiguity and read as zero.
function parseUncompressed(s) {
  const m = s.match(/^(\d{2})([\d ]{2})\.([\d ]{2})([NS])(.)(\d{3})([\d ]{2})\.([\d ]{2})([EW])(.)/);
  if (!m) return null;
  const mins = (a, b) => parseFloat(`${a}.${b}`.replace(/ /g, '0'));
  let lat = +m[1] + mins(m[2], m[3]) / 60;
  let lon = +m[6] + mins(m[7], m[8]) / 60;
  if (m[4] === 'S') lat = -lat;
  if (m[9] === 'W') lon = -lon;
  return { lat, lon, ...symbolOf(m[5], m[10]), rest: s.slice(19), compressed: false };
}

// /YYYYXXXX$csT - base-91 lat/lon, then course/speed or altitude.
function parseCompressed(s) {
  if (s.length < 13 || !/^[/\\A-Za-j]$/.test(s[0]) || !/^[!-{]{8}$/.test(s.slice(1, 9))) return null;
  const table = /[a-j]/.test(s[0]) ? String(s.charCodeAt(0) - 97) : s[0];
  const out = {
    lat: 90 - b91(s.slice(1, 5)) / 380926,
    lon: -180 + b91(s.slice(5, 9)) / 190463,
    ...symbolOf(table, s[9]),
    rest: s.slice(13), compressed: true,
  };
  if (s[10] !== ' ') {
    const c = s.charCodeAt(10) - 33, sp = s.charCodeAt(11) - 33, t = s.charCodeAt(12) - 33;
    if ((t & 0x18) === 0x10) out.alt = Math.pow(1.002, c * 91 + sp) * FT_M;
    else if (c >= 0 && c <= 89) { out.course = c * 4; out.speed = (Math.pow(1.08, sp) - 1) * KNOT_KMH; }
  }
  return out;
}

const parsePosition = s => (/^\d/.test(s) ? parseUncompressed(s) : parseCompressed(s));

// Weather fields have fixed widths and follow wind direction/speed.
const WX_FIELDS = { g: 3, t: 3, r: 3, p: 3, P: 3, h: 2, b: 5, L: 3, l: 3, s: 3, '#': 3 };

function parseWeather(s, windInPosition) {
  const wx = {};
  const val = v => (/^-?\d+$/.test(v) ? +v : null);
  let m = windInPosition ? s.match(/^([\d. ]{3})\/([\d. ]{3})/) : s.match(/^c([\d. ]{3})s([\d. ]{3})/);
  if (m) {
    wx.windDir = val(m[1]);
    wx.windMph = val(m[2]);
    s = s.slice(m[0].length);
  }
  while (s && WX_FIELDS[s[0]]) {
    const key = s[0], v = val(s.substr(1, WX_FIELDS[key]).trim());
    s = s.slice(1 + WX_FIELDS[key]);
    if (v === null) continue;
    if (key === 'g') wx.gustMph = v;
    else if (key === 't') wx.tempF = v;
    else if (key === 'r') wx.rain1hIn = v / 100;
    else if (key === 'p') wx.rain24hIn = v / 100;
    else if (key === 'P') wx.rainMidnightIn = v / 100;
    else if (key === 'h') wx.humidity = v === 0 ? 100 : v;
    else if (key === 'b') wx.pressureHpa = v / 10;
    else if (key === 's' && !m) wx.windMph = v;
  }
  const hasData = Object.values(wx).some(v => v !== null && v !== undefined);
  return hasData ? { wx, rest: s } : { wx: null, rest: s };
}

// Course/speed or PHG/RNG/DFS extension, /A= altitude, then the comment.
function parseExtras(pos, isWeather) {
  let rest = pos.rest;
  const out = { ...pos };
  delete out.rest;
  if (/^(PHG|RNG|DFS)\w{4}/.test(rest)) {
    rest = rest.slice(7);
  } else if (isWeather) {
    const w = parseWeather(rest, true);
    if (w.wx) out.wx = w.wx;
    rest = w.rest;
  } else if (!pos.compressed) {
    const m = rest.match(/^(\d{3})\/(\d{3})/);
    if (m) {
      if (+m[1] > 0 || +m[2] > 0) { out.course = +m[1] % 360; out.speed = +m[2] * KNOT_KMH; }
      rest = rest.slice(7);
    } else if (/^(PHG|RNG|DFS)\w{4}/.test(rest)) {
      rest = rest.slice(7);
    }
  }
  const a = rest.match(/\/A=(-?\d{5,6})/);
  if (a) { out.alt = +a[1] * FT_M; rest = rest.replace(a[0], ''); }
  out.comment = cleanComment(rest);
  return out;
}

// Strip control bytes, DAO precision (!wXY!), base-91 telemetry (|...|) and
// the TinyTrak marker, which are machine data rather than readable comment.
const cleanComment = s => s
  .replace(/[\x00-\x1f\x7f]/g, '')
  .replace(/![wW][!-{]{2}!/g, '')
  .replace(/\|[!-{]{4,14}\|/g, '')
  .replace(/\|3$/, '')
  .replace(/^\/+/, '')
  .trim()
  .slice(0, 200);

// Mic-E: latitude and flags live in the destination address, longitude,
// speed, course and symbol in the first bytes of the information field.
function parseMicE(dest, info) {
  const d = dest.split('-')[0];
  if (d.length !== 6 || info.length < 9) return null;
  let digits = '';
  const flag = [];
  for (let i = 0; i < 6; i++) {
    const c = d[i];
    if (c >= '0' && c <= '9') digits += c;
    else if (c >= 'A' && c <= 'J' && i < 3) digits += String(c.charCodeAt(0) - 65);
    else if (c >= 'P' && c <= 'Y') digits += String(c.charCodeAt(0) - 80);
    else if (c === 'K' || c === 'L' || c === 'Z') digits += '0';
    else return null;
    flag.push(c >= 'P' && c <= 'Z');
  }
  let lat = +digits.slice(0, 2) + (+digits.slice(2, 4) + +digits.slice(4, 6) / 100) / 60;
  if (!flag[3]) lat = -lat;

  const b = i => info.charCodeAt(i) - 28;
  let lonDeg = b(1) + (flag[4] ? 100 : 0);
  if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80;
  else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;
  let lonMin = b(2);
  if (lonMin >= 60) lonMin -= 60;
  let lon = lonDeg + (lonMin + b(3) / 100) / 60;
  if (flag[5]) lon = -lon;

  let speed = b(4) * 10 + Math.floor(b(5) / 10);
  if (speed >= 800) speed -= 800;
  let course = (b(5) % 10) * 100 + b(6);
  if (course >= 400) course -= 400;

  const out = { lat, lon, ...symbolOf(info[8], info[7]) };
  if (speed > 0 || course > 0) { out.speed = speed * KNOT_KMH; out.course = course % 360; }
  let rest = info.slice(9);
  const alt = rest.match(/^[`'>\]]?([!-{]{3})\}/);
  if (alt) { out.alt = b91(alt[1]) - 10000; rest = rest.slice(alt[0].length); }
  // Drop the radio-type marker bytes Kenwood/Yaesu/etc. add around the comment.
  out.comment = cleanComment(rest.replace(/^[`'>\]]/, '').replace(/(=|\^|`?_[ "#$%()]?|[_"]\$)$/, ''));
  return out;
}

// One APRS-IS line -> a normalized record, or null if it carries nothing we use.
function parsePacket(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const header = line.slice(0, colon), info = line.slice(colon + 1);
  const gt = header.indexOf('>');
  if (gt < 1 || !info) return null;
  const src = header.slice(0, gt).toUpperCase();
  const [dest = '', ...path] = header.slice(gt + 1).split(',');
  const base = { src, name: src, kind: 'station', path: parsePath(path) };
  const type = info[0];

  try {
    if (type === '}') return parsePacket(info.slice(1));
    if (type === '!' || type === '=' || type === '/' || type === '@') {
      const pos = parsePosition(type === '/' || type === '@' ? info.slice(8) : info.slice(1));
      if (!validPos(pos)) return null;
      return { ...base, ...parseExtras(pos, pos.symbol[1] === '_') };
    }
    if (type === '`' || type === "'") {
      const pos = parseMicE(dest, info);
      return validPos(pos) ? { ...base, ...pos } : null;
    }
    if (type === ';') {
      const name = info.slice(1, 10).trim();
      if (!name || info.length < 18) return null;
      if (info[10] === '_') return { ...base, name, kind: 'object', killed: true };
      const pos = parsePosition(info.slice(18));
      if (!validPos(pos)) return null;
      return { ...base, ...parseExtras(pos, pos.symbol[1] === '_'), name, kind: 'object', owner: src };
    }
    if (type === ')') {
      const m = info.match(/^\)([^!_]{3,9})([!_])/);
      if (!m) return null;
      if (m[2] === '_') return { ...base, name: m[1].trim(), kind: 'item', killed: true };
      const pos = parsePosition(info.slice(m[0].length));
      if (!validPos(pos)) return null;
      return { ...base, ...parseExtras(pos, pos.symbol[1] === '_'), name: m[1].trim(), kind: 'item', owner: src };
    }
    if (type === '_') {
      const w = parseWeather(info.slice(9), false);
      return w.wx ? { ...base, wx: w.wx } : null;
    }
    if (type === '>') {
      const status = cleanComment(info.slice(1).replace(/^\d{6}z/, ''));
      return status ? { ...base, status } : null;
    }
  } catch {
    return null;
  }
  return null;
}

// Path like ["WIDE1*","WIDE2-1","qAR","AA6HF"] -> digipeaters used and the iGate.
function parsePath(path) {
  const q = path.findIndex(p => /^qA./.test(p));
  const hops = (q >= 0 ? path.slice(0, q) : path);
  const used = hops.filter(p => p.endsWith('*')).map(p => p.slice(0, -1)).filter(p => !/^(WIDE|TRACE|RELAY)/.test(p));
  const igate = q >= 0 ? path[q + 1] || '' : '';
  const viaInternet = hops.some(p => /^TCPIP/.test(p));
  return { digis: used, igate, internet: viaInternet };
}

// ---------------------------------------------------------------- client

class AprsIs {
  constructor({ userAgent }) {
    this.vers = userAgent;
    this.stations = new Map();
    this.status = 'disabled';
    this.server = '';
    this.error = null;
    this.retryMs = 5000;
    this.center = null;
    this.radiusKm = 0;
    this.packets = 0;
    setInterval(() => this.prune(), MIN).unref();
  }

  start({ enabled, callsign, center, radiusKm }) {
    if (!enabled) { this.status = 'disabled'; return; }
    if (!callsign) { this.status = 'no-callsign'; return; }
    if (!center) { this.status = 'no-grid'; return; }
    Object.assign(this, { callsign, center, radiusKm });
    this.connect();
  }

  connect() {
    this.status = 'connecting';
    let buf = '';
    const sock = net.connect(14580, 'rotate.aprs2.net');
    // Mic-E bytes are all printable ASCII, so UTF-8 is safe and shows
    // non-English comments correctly.
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 60_000);
    // Servers send a "#" keepalive every ~20 s, so silence means a dead link.
    sock.setTimeout(3 * MIN, () => sock.destroy(new Error('no data for 3 minutes')));
    sock.on('connect', () => {
      const { lat, lon } = this.center;
      sock.write(`user ${this.callsign} pass -1 vers ${this.vers} filter r/${lat.toFixed(2)}/${lon.toFixed(2)}/${Math.round(this.radiusKm)}\r\n`);
    });
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('#')) {
          const m = line.match(/logresp \S+ (\w+), server (\S+)/);
          if (m) {
            this.status = 'connected';
            this.server = m[2];
            this.error = null;
            this.retryMs = 5000;
            console.log(`[aprs] connected to ${m[2]} (${m[1]}), range ${Math.round(this.radiusKm)} km`);
          }
          continue;
        }
        this.packets++;
        this.ingest(parsePacket(line), Date.now());
      }
      if (buf.length > 16384) buf = buf.slice(-2048);
    });
    sock.on('error', err => { this.error = err.message; });
    sock.on('close', () => {
      this.status = 'reconnecting';
      console.warn(`[aprs] disconnected (${this.error || 'closed'}), retry in ${this.retryMs / 1000}s`);
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5 * MIN);
    });
  }

  ingest(p, now) {
    if (!p) return;
    const key = p.kind === 'station' ? p.src : `${p.kind}:${p.name}`;
    if (p.killed) { this.stations.delete(key); return; }
    const st = this.stations.get(key) || { name: p.name, kind: p.kind, count: 0, track: [] };
    st.count++;
    st.lastHeard = now;
    st.path = p.path;
    if (p.owner) st.owner = p.owner;
    if (p.lat !== undefined) {
      const last = st.track[st.track.length - 1];
      if (!last || Math.abs(last[0] - p.lat) > 0.0005 || Math.abs(last[1] - p.lon) > 0.0005) {
        st.track.push([+p.lat.toFixed(5), +p.lon.toFixed(5), now]);
        if (st.track.length > TRACK_POINTS) st.track.shift();
      }
      Object.assign(st, { lat: p.lat, lon: p.lon, symbol: p.symbol, overlay: p.overlay, posTime: now });
      st.course = p.course;
      st.speed = p.speed;
      if (p.alt !== undefined) st.alt = p.alt;
      if (p.comment) st.comment = p.comment;
    }
    if (p.wx) { st.wx = p.wx; st.wxTime = now; }
    if (p.status) st.status = p.status;
    this.stations.set(key, st);
  }

  prune() {
    const cutoff = Date.now() - STATION_TTL;
    for (const [k, st] of this.stations) if (st.lastHeard < cutoff) this.stations.delete(k);
  }

  snapshot() {
    return {
      status: this.status, server: this.server, error: this.error,
      center: this.center, radiusKm: this.radiusKm, packets: this.packets,
      stations: [...this.stations.values()]
        .filter(st => st.lat !== undefined)
        .sort((a, b) => b.lastHeard - a.lastHeard),
    };
  }
}

module.exports = { AprsIs, parsePacket };
