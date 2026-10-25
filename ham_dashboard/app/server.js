'use strict';
// Ham Radio Dashboard - Home Assistant add-on backend.
// Zero dependencies: Node 20+ (global fetch). Serves the UI over ingress and
// fetches/caches public space-weather, propagation and spot data.

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const PORT = +(process.env.PORT || 8099);
const STATIC_DIR = path.join(__dirname, 'static');
const SWPC = 'https://services.swpc.noaa.gov';
const UA = 'SwampFoxLabs-HamRadioDashboard/0.1 (Home Assistant app; github.com/SWFX2324/swamp-fox-labs-apps)';

// ---------------------------------------------------------------- options

function loadOptions() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); } catch { /* local run */ }
  const env = process.env;
  return {
    callsign: String(env.CALLSIGN ?? o.callsign ?? '').trim().toUpperCase(),
    grid: String(env.GRID ?? o.grid ?? '').trim(),
    distance_units: env.UNITS ?? o.distance_units ?? 'mi',
    dx_cluster_enabled: String(env.DX_CLUSTER ?? o.dx_cluster_enabled ?? true) !== 'false',
    dx_cluster_host: env.DX_HOST ?? o.dx_cluster_host ?? 'dxc.ve7cc.net',
    dx_cluster_port: +(env.DX_PORT ?? o.dx_cluster_port ?? 23),
    qrz_username: String(env.QRZ_USER ?? o.qrz_username ?? '').trim(),
    qrz_password: String(env.QRZ_PASS ?? o.qrz_password ?? ''),
  };
}
const options = loadOptions();

// ---------------------------------------------------------------- cache / fetch

const cache = new Map();

// Returns the cached value while fresh; refetches once (shared in-flight promise)
// when stale; on failure keeps serving the stale value and retries in a minute.
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && 'v' in hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
  if (hit && hit.p) return hit.p;
  const p = fn()
    .then(v => { cache.set(key, { t: Date.now(), v }); return v; })
    .catch(err => {
      if (hit && 'v' in hit) {
        console.warn(`[cache] ${key}: ${err.message} (serving stale)`);
        cache.set(key, { t: Date.now() - ttlMs + 60_000, v: hit.v });
        return hit.v;
      }
      cache.delete(key);
      throw err;
    });
  cache.set(key, { ...(hit || {}), p });
  return p;
}

async function get(url, type = 'json') {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return type === 'json' ? r.json() : r.text();
}

const MIN = 60_000;
const num = s => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

// NOAA products are either arrays of objects or [header, ...rows] arrays.
function rows(data) {
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const [h, ...r] = data;
    return r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]])));
  }
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------- data sources

function xmlTag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

function hamqsl() {
  return cached('hamqsl', 30 * MIN, async () => {
    const xml = await get('https://www.hamqsl.com/solarxml.php', 'text');
    const bands = {};
    for (const m of xml.matchAll(/<band name="([^"]+)" time="(day|night)">([^<]*)<\/band>/g)) {
      (bands[m[1]] ||= { name: m[1] })[m[2]] = m[3].trim();
    }
    const vhf = [...xml.matchAll(/<phenomenon name="([^"]+)" location="([^"]+)">([^<]*)<\/phenomenon>/g)]
      .map(m => ({ name: m[1], location: m[2], status: m[3].trim() }));
    return {
      updated: xmlTag(xml, 'updated'),
      sfi: num(xmlTag(xml, 'solarflux')),
      ssn: num(xmlTag(xml, 'sunspots')),
      a: num(xmlTag(xml, 'aindex')),
      k: num(xmlTag(xml, 'kindex')),
      xray: xmlTag(xml, 'xray'),
      protonflux: num(xmlTag(xml, 'protonflux')),
      electronflux: num(xmlTag(xml, 'electonflux')),
      aurora: num(xmlTag(xml, 'aurora')),
      solarwind: num(xmlTag(xml, 'solarwind')),
      bz: num(xmlTag(xml, 'magneticfield')),
      geomagfield: xmlTag(xml, 'geomagfield'),
      signalnoise: xmlTag(xml, 'signalnoise'),
      bands: Object.values(bands),
      vhf,
    };
  });
}

function noaaScales() {
  return cached('scales', 10 * MIN, async () => {
    const d = await get(`${SWPC}/products/noaa-scales.json`);
    const day = k => d[k] && {
      date: d[k].DateStamp,
      R: { scale: num(d[k].R?.Scale), text: d[k].R?.Text, minorProb: num(d[k].R?.MinorProb), majorProb: num(d[k].R?.MajorProb) },
      S: { scale: num(d[k].S?.Scale), text: d[k].S?.Text, prob: num(d[k].S?.Prob) },
      G: { scale: num(d[k].G?.Scale), text: d[k].G?.Text },
    };
    return { yesterday: day('-1'), current: day('0'), forecast: ['1', '2', '3'].map(day).filter(Boolean) };
  });
}

function kp() {
  return cached('kp', 15 * MIN, async () => {
    const r = rows(await get(`${SWPC}/products/noaa-planetary-k-index-forecast.json`));
    return r.map(x => ({
      time: String(x.time_tag).replace(' ', 'T') + (String(x.time_tag).endsWith('Z') ? '' : 'Z'),
      kp: num(x.kp ?? x.Kp),
      kind: x.observed ?? 'observed',
    })).filter(x => x.kp !== null);
  });
}

function solarWind() {
  return cached('wind', 5 * MIN, async () => {
    const [speed, mag, flux] = await Promise.all([
      get(`${SWPC}/products/summary/solar-wind-speed.json`),
      get(`${SWPC}/products/summary/solar-wind-mag-field.json`),
      get(`${SWPC}/products/summary/10cm-flux.json`),
    ]);
    const s = rows(speed)[0] || {}, m = rows(mag)[0] || {}, f = rows(flux)[0] || {};
    return { speed: num(s.proton_speed), bt: num(m.bt), bz: num(m.bz_gsm), time: s.time_tag, f107: num(f.flux) };
  });
}

function xrayClass(flux) {
  if (!(flux > 0)) return null;
  const classes = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]];
  for (const [c, base] of classes) if (flux >= base) return c + (flux / base).toFixed(1);
  return 'A0.0';
}

function xray() {
  return cached('xray', 5 * MIN, async () => {
    const d = rows(await get(`${SWPC}/json/goes/primary/xrays-6-hour.json`))
      .filter(x => x.energy === '0.1-0.8nm' && x.flux > 0);
    if (!d.length) return null;
    const last = d[d.length - 1];
    const max = d.reduce((a, b) => (b.flux > a.flux ? b : a));
    return { current: xrayClass(last.flux), flux: last.flux, time: last.time_tag, max6h: xrayClass(max.flux), max6hTime: max.time_tag };
  });
}

function alerts() {
  return cached('alerts', 10 * MIN, async () => {
    const cutoff = Date.now() - 72 * 3600_000;
    return rows(await get(`${SWPC}/products/alerts.json`))
      .map(a => {
        const msg = String(a.message || '').replace(/\r/g, '');
        const title = (msg.match(/^(?:ALERT|WARNING|WATCH|SUMMARY|CONTINUED ALERT|EXTENDED WARNING|CANCEL[^:]*):.*$/m) || [])[0]
          || msg.split('\n').find(l => l.trim() && !/^(Space Weather Message Code|Serial Number|Issue Time)/.test(l)) || a.product_id;
        return { id: a.product_id, time: String(a.issue_datetime).replace(' ', 'T') + 'Z', title: title.trim(), message: msg };
      })
      .filter(a => Date.parse(a.time) > cutoff)
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 20);
  });
}

function forecast3day() {
  return cached('3day', 60 * MIN, () => get(`${SWPC}/text/3-day-forecast.txt`, 'text'));
}

function solarCycle() {
  return cached('cycle', 12 * 60 * MIN, async () => {
    const [obs, pred] = await Promise.all([
      get(`${SWPC}/json/solar-cycle/observed-solar-cycle-indices.json`),
      get(`${SWPC}/json/solar-cycle/predicted-solar-cycle.json`),
    ]);
    const pos = v => (v >= 0 ? v : null);
    return {
      observed: obs.filter(x => x['time-tag'] >= '2008-01')
        .map(x => ({ t: x['time-tag'], ssn: pos(x.ssn), smoothed: pos(x.smoothed_ssn) })),
      predicted: pred.map(x => ({ t: x['time-tag'], ssn: pos(x.predicted_ssn), high: pos(x.high_ssn), low: pos(x.low_ssn) })),
    };
  });
}

function ionosondes() {
  return cached('iono', 10 * MIN, async () => {
    const cutoff = Date.now() - 3 * 3600_000;
    return (await get('https://prop.kc2g.com/api/stations.json'))
      .map(s => {
        let lon = num(s.station?.longitude);
        if (lon > 180) lon -= 360;
        return {
          code: s.station?.code, name: s.station?.name,
          lat: num(s.station?.latitude), lon,
          time: s.time + 'Z', cs: s.cs, mufd: num(s.mufd), fof2: num(s.fof2),
        };
      })
      .filter(s => s.mufd && s.lat !== null && Date.parse(s.time) > cutoff && s.cs > 0);
  });
}

function propMap(kind) {
  return cached(`map-${kind}`, 10 * MIN, () => get(`https://prop.kc2g.com/renders/current/${kind}-normal-now.svg`, 'text'));
}

function pskReports(call, minutes) {
  return cached(`psk-${call}-${minutes}`, 5 * MIN, async () => {
    const url = `https://retrieve.pskreporter.info/query?senderCallsign=${encodeURIComponent(call)}&flowStartSeconds=-${minutes * 60}&rronly=1`;
    const xml = await get(url, 'text');
    const reports = [];
    for (const m of xml.matchAll(/<receptionReport\s([^>]*?)\/>/g)) {
      const a = {};
      for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[x[1]] = x[2];
      reports.push({
        rx: a.receiverCallsign, rxGrid: a.receiverLocator, rxCountry: a.receiverDXCC,
        txGrid: a.senderLocator, freq: num(a.frequency), mode: a.mode,
        snr: num(a.sNR), time: num(a.flowStartSeconds),
      });
    }
    return { call, minutes, reports: reports.sort((a, b) => b.time - a.time) };
  });
}

// ---------------------------------------------------------------- DX cluster

const BANDS = [
  ['160m', 1800, 2000], ['80m', 3500, 4000], ['60m', 5330, 5410], ['40m', 7000, 7300],
  ['30m', 10100, 10150], ['20m', 14000, 14350], ['17m', 18068, 18168], ['15m', 21000, 21450],
  ['12m', 24890, 24990], ['10m', 28000, 29700], ['6m', 50000, 54000], ['2m', 144000, 148000],
];
const bandOf = khz => (BANDS.find(([, lo, hi]) => khz >= lo && khz <= hi) || [null])[0];

// Upper edge of the CW segment per band (kHz); above it we assume phone/digital.
const CW_TOP = { '160m': 1840, '80m': 3570, '40m': 7040, '30m': 10150, '20m': 14070, '17m': 18095, '15m': 21070, '12m': 24915, '10m': 28070, '6m': 50100, '2m': 144100 };
const FT8 = [1840, 3573, 5357, 7074, 10136, 14074, 18100, 21074, 24915, 28074, 50313, 50323, 144174];
const FT4 = [3575, 7047.5, 10140, 14080, 18104, 21140, 24919, 28180, 50318];

function guessMode(khz, comment, band) {
  const c = comment.toUpperCase();
  const m = c.match(/\b(FT8|FT4|RTTY|PSK31|PSK63|JT65|JS8|SSTV|CW|SSB|USB|LSB|AM|FM|MSK144|Q65)\b/);
  if (m) return ['USB', 'LSB'].includes(m[1]) ? 'SSB' : m[1];
  if (FT8.some(f => khz >= f && khz <= f + 3)) return 'FT8';
  if (FT4.some(f => khz >= f && khz <= f + 3)) return 'FT4';
  if (band === '60m') return 'SSB';
  return khz <= (CW_TOP[band] ?? 0) ? 'CW' : 'SSB';
}

// Minimal prefix -> continent table (longest prefix wins). Good enough to filter
// spots by where the spotter is; not a substitute for a full cty.dat.
const CONT_PREFIXES = {
  NA: 'K W N AA AB AC AD AE AF AG AI AJ AK AL KL7 KP2 KP4 VE VA VO VY CY XE XF TI HP YN HR TG YS HI CO CM 6Y J3 J6 J7 J8 V2 V3 V4 VP2 VP5 VP9 ZF 8P FG FM FS PJ C6 HH OX',
  SA: 'PP PQ PR PS PT PU PV PW PX PY ZV ZW ZX ZY ZZ LU LO LP LQ LR LS LT LV LW CE CA CB CC CD XQ XR CX ZP OA OB OC HC HK HJ 5J 5K YV YW YX YY 9Y PZ FY 8R CP VP8',
  EU: 'G M 2E 2M F TM DL DA DB DC DD DE DF DG DH DI DJ DK DM DN DO DP DQ DR I EA EB EC ED EE EF EG EH PA PB PC PD PE PF PG PH PI ON OO OP OQ OR OS OT OE HB OK OL OM SP SQ SN SO SR 3Z HA HG YO YP YQ YR LZ SV SX SY SZ 9A S5 E7 YU YT Z3 OH OG OF OI SM SA SB SC SD SE SF SG SH SI SJ SK SL 7S 8S LA LB LC LD LE LF LG LH LI LJ LN OZ OU OV 5P 5Q TF EI EJ GI MI GM MM GW MW GD MD GJ MJ GU MU ES YL LY UR US UT UU UV UW UX UY UZ EM EN EO EU EV EW ER CT CS CU 4O Z6 T7 1A HV 3A LX OY IS R U',
  AS: 'JA JE JF JG JH JI JJ JK JL JM JN JO JP JQ JR JS 7J 7K 7L 7M 7N 8J BV BU BW BX BY BA BD BG BH BI BJ BL BM BN BO BP BQ BR BS BT HL DS DT 6K 6L 6M 6N VU AT HS E2 9M 9V YB YC YD YE YF YG YH DU DV DW DX DY DZ 4X 4Z A4 A6 A7 A9 HZ 7Z EP AP 4S S2 XV 3W XU XW 9N UN UP UQ EX EY EZ UK 4L EK 4J TA YM JT VR2 9K YI OD JY',
  OC: 'VK AX ZL KH6 KH7 KH2 KH0 KH8 YJ FK 3D2 5W A3 P2 T2 T3 V7 V6 FO E5',
  AF: 'ZS ZR ZT ZU 5H 5Z 5N CN 7X SU ET 9J Z2 V5 A2 9G TU 6W D2 3V 5R 3B8 FR EA8 EA9 CT3 ST TT TJ TR TN 9Q 9X 5X C9 7Q 5T 5U 5V TZ XT 9L EL D4 J5 3C 3X S7 S9 TL 7P 3DA 6O T5 E3 J2 5A',
};
const PREFIX_MAP = new Map();
for (const [cont, list] of Object.entries(CONT_PREFIXES)) for (const p of list.split(' ')) PREFIX_MAP.set(p, cont);

function baseCall(call) {
  const parts = call.toUpperCase().replace(/-.*$/, '').split('/')
    .filter(p => p && !/^(P|M|MM|AM|QRP|A|\d+)$/.test(p));
  if (!parts.length) return call.toUpperCase();
  return parts.reduce((a, b) => (b.length < a.length ? b : a));
}

function continentOf(call) {
  const c = baseCall(call);
  if (/^(R|U[A-I])[A-Z]?[089]/.test(c)) return 'AS'; // Asiatic Russia
  for (let n = Math.min(4, c.length); n > 0; n--) {
    const cont = PREFIX_MAP.get(c.slice(0, n));
    if (cont) return cont;
  }
  return null;
}

class Cluster {
  constructor() {
    this.spots = [];
    this.status = 'disabled';
    this.error = null;
    this.retryMs = 5000;
  }

  start(opts) {
    if (!opts.dx_cluster_enabled) { this.status = 'disabled'; return; }
    if (!opts.callsign) { this.status = 'no-callsign'; return; }
    this.opts = opts;
    this.connect();
  }

  connect() {
    const { dx_cluster_host: host, dx_cluster_port: port, callsign } = this.opts;
    this.status = 'connecting';
    let buf = '';
    let loggedIn = false;
    const sock = net.connect(port, host);
    sock.setEncoding('latin1');
    sock.setKeepAlive(true, 60_000);
    sock.setTimeout(10 * MIN, () => sock.destroy(new Error('no data for 10 minutes')));
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        this.line(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
      if (!loggedIn && /(login|call)[^\n]*:\s*$/i.test(buf)) {
        sock.write(callsign + '\r\n');
        loggedIn = true;
        this.status = 'connected';
        this.error = null;
        this.retryMs = 5000;
        console.log(`[cluster] logged in to ${host}:${port} as ${callsign}`);
      }
      if (buf.length > 8192) buf = buf.slice(-1024);
    });
    sock.on('error', err => { this.error = err.message; });
    sock.on('close', () => {
      this.status = 'reconnecting';
      console.warn(`[cluster] disconnected (${this.error || 'closed'}), retry in ${this.retryMs / 1000}s`);
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5 * MIN);
    });
  }

  line(text) {
    const m = text.match(/^DX de ([A-Z0-9/#-]+):?\s+(\d+(?:\.\d+)?)\s+([A-Z0-9/]+)\s+(.*?)\s*(\d{4})Z/i);
    if (!m) return;
    const [, spotter, f, dx, comment, hhmm] = m;
    const khz = parseFloat(f);
    const band = bandOf(khz);
    const now = new Date();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +hhmm.slice(0, 2), +hhmm.slice(2)));
    if (t - now > 5 * MIN) t.setUTCDate(t.getUTCDate() - 1);
    const spotterCall = spotter.replace(/-#$/, '').replace(/-\d+$/, '');

    // Collapse repeat spots of the same station on the same frequency.
    const dup = this.spots.find(s => s.dx === dx && Math.abs(s.freq - khz) < 1 && t - Date.parse(s.time) < 30 * MIN);
    if (dup) {
      dup.count++;
      dup.time = t.toISOString();
      if (!dup.spotterConts.includes(continentOf(spotterCall))) dup.spotterConts.push(continentOf(spotterCall));
      if (comment && !dup.comment) dup.comment = comment;
      return;
    }
    this.spots.unshift({
      time: t.toISOString(), freq: khz, band, dx, spotter: spotterCall,
      comment, mode: guessMode(khz, comment, band), skimmer: spotter.endsWith('-#'),
      dxCont: continentOf(dx), spotterConts: [continentOf(spotterCall)], count: 1,
    });
    if (this.spots.length > 400) this.spots.length = 400;
  }
}

const cluster = new Cluster();

// ---------------------------------------------------------------- geo

const RAD = Math.PI / 180;
const DAY = 24 * 60 * MIN;

function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// ---------------------------------------------------------------- repeaters (HearHam)

// HearHam publishes its whole directory as one free download (~10 MB). We fetch
// it at most once a day, keep a copy in /data so restarts don't refetch, and
// filter by distance locally.
const DATA_DIR = fs.existsSync('/data') ? '/data' : require('os').tmpdir();
const HEARHAM_FILE = path.join(DATA_DIR, 'hearham-repeaters.json');

function normalizeMode(mode) {
  const parts = String(mode || '').toUpperCase().replace(/\s+/g, '').split(/[/,+]/).filter(Boolean).map(p =>
    /^D-?STAR$/.test(p) ? 'D-STAR'
      : /^(YSF|C4FM|FUSION)$/.test(p) ? 'Fusion'
        : /^(FM|NFM|WFM|ANALOG)$/.test(p) ? 'FM'
          : /^AX\.?25$/.test(p) ? 'Packet' : p);
  return [...new Set(parts)].join('/') || 'FM';
}

// CTCSS tones are >= 67 Hz; small numbers on digital repeaters are DMR color codes.
const toneOf = v => { const n = parseFloat(v); return n >= 60 ? n.toFixed(1) : n > 0 ? String(Math.round(n)) : ''; };

function slimRepeaters(list) {
  return list
    .filter(r => Number.isFinite(+r.latitude) && Number.isFinite(+r.longitude) && +r.frequency > 0)
    .map(r => ({
      id: r.id,
      call: String(r.callsign || '').trim().toUpperCase(),
      lat: +r.latitude, lon: +r.longitude,
      city: String(r.city || '').trim(),
      group: String(r.group || '').trim(),
      node: String(r.internet_node || '').trim(),
      mode: normalizeMode(r.mode),
      freq: +r.frequency, offset: +r.offset || 0,
      encode: toneOf(r.encode), decode: toneOf(r.decode),
      description: String(r.description || '').trim(),
      power: r.power && r.power !== 'unknown' ? r.power : '',
      operational: +r.operational === 1,
      restriction: String(r.restriction || '').trim(),
    }));
}

function repeaterDb() {
  return cached('hearham', 6 * 60 * MIN, async () => {
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(HEARHAM_FILE, 'utf8')); } catch { /* first run */ }
    if (disk && Date.now() - disk.fetched < DAY) return disk;
    try {
      const db = { fetched: Date.now(), list: slimRepeaters(await get('https://hearham.com/api/repeaters/v1')) };
      fs.writeFile(HEARHAM_FILE, JSON.stringify(db), err => err && console.warn('[repeaters] cache write failed:', err.message));
      console.log(`[repeaters] downloaded ${db.list.length} repeaters from HearHam`);
      return db;
    } catch (err) {
      if (disk) { console.warn(`[repeaters] ${err.message} (using copy from ${new Date(disk.fetched).toISOString()})`); return disk; }
      throw err;
    }
  });
}

async function nearbyRepeaters(pos, radiusKm) {
  const db = await repeaterDb();
  const out = [];
  for (const r of db.list) {
    if (Math.abs(r.lat - pos.lat) > radiusKm / 100 + 0.5) continue; // cheap prefilter
    const dist = distanceKm(pos, r);
    if (dist <= radiusKm) out.push({ ...r, dist, bearing: bearingDeg(pos, r) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return { source: 'HearHam', fetched: new Date(db.fetched).toISOString(), total: out.length, repeaters: out.slice(0, 500) };
}

// ---------------------------------------------------------------- callsign lookup

const QRZ_AGENT = 'SwampFoxLabsHamDash-0.2';
let qrzSession = null;
const qrzConfigured = () => Boolean(options.qrz_username && options.qrz_password);

const unescapeXml = s => s && s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// The request URL carries the user's QRZ password, so it must never appear in
// an error message or log line.
async function qrzRequest(params) {
  const r = await fetch(`https://xmldata.qrz.com/xml/current/?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`QRZ returned HTTP ${r.status}`);
  return r.text();
}

async function qrzLogin() {
  const xml = await qrzRequest({ username: options.qrz_username, password: options.qrz_password, agent: QRZ_AGENT });
  const key = xmlTag(xml, 'Key');
  if (!key) throw new Error(`QRZ login failed: ${xmlTag(xml, 'Error') || 'no session key returned'}`);
  qrzSession = { key, sub: xmlTag(xml, 'SubExp') || '' };
  return qrzSession;
}

function parseQrz(block, sub) {
  const f = name => unescapeXml(xmlTag(block, name)) || '';
  const call = f('call');
  return {
    source: 'qrz', subscriber: !/non-subscriber/i.test(sub),
    call, aliases: f('aliases'),
    name: f('name_fmt') || [f('fname'), f('name')].filter(Boolean).join(' '),
    nickname: f('nickname'),
    addr1: f('addr1'), addr2: f('addr2'), state: f('state'), zip: f('zip'),
    county: f('county'), country: f('country'),
    lat: num(f('lat')), lon: num(f('lon')), grid: f('grid'),
    class: f('class'), effective: f('efdate'), expires: f('expdate'),
    qslmgr: f('qslmgr'), eqsl: f('eqsl') === '1', lotw: f('lotw') === '1', mqsl: f('mqsl') === '1',
    dxcc: f('dxcc'), cqzone: f('cqzone'), ituzone: f('ituzone'), timezone: f('TimeZone'),
    image: f('image'),
    url: `https://www.qrz.com/db/${encodeURIComponent(call)}`,
  };
}

async function qrzLookup(call) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = qrzSession || await qrzLogin();
    const xml = await qrzRequest({ s: session.key, callsign: call });
    const sess = xmlTag(xml, 'Session') || '';
    const error = xmlTag(sess, 'Error');
    const block = xmlTag(xml, 'Callsign');
    if (block) return parseQrz(block, session.sub);
    if (error && /not found/i.test(error)) return null;
    if (attempt === 0 && (!xmlTag(sess, 'Key') || /session|timeout|invalid/i.test(error || ''))) { qrzSession = null; continue; }
    throw new Error(`QRZ: ${error || 'unexpected response'}`);
  }
  return null;
}

async function callookLookup(call) {
  const d = await get(`https://callook.info/${encodeURIComponent(call)}/json`);
  if (d.status !== 'VALID') return null;
  return {
    source: 'callook',
    call: d.current?.callsign || call,
    name: d.name || '',
    type: d.type || '',
    class: d.current?.operClass || (d.type === 'CLUB' ? 'Club' : ''),
    addr1: d.address?.line1 || '', addr2: d.address?.line2 || '',
    country: 'United States',
    lat: num(d.location?.latitude), lon: num(d.location?.longitude), grid: d.location?.gridsquare || '',
    effective: d.otherInfo?.grantDate || '', expires: d.otherInfo?.expiryDate || '',
    trustee: d.trustee?.callsign || '', previous: d.previous?.callsign || '',
    uls: d.otherInfo?.ulsUrl || '',
    url: `https://www.qrz.com/db/${encodeURIComponent(call)}`,
  };
}

const US_CALL = /^(A[A-L]|K|N|W)[A-Z]?\d[A-Z]{1,3}$/;
const stripEmpty = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

function lookupCall(call) {
  return cached(`lookup-${call}`, DAY, async () => {
    let qrz = null, warning = null;
    if (qrzConfigured()) {
      try { qrz = await qrzLookup(call); } catch (e) { warning = e.message; qrzSession = null; }
    }
    // Fill gaps from FCC data for US calls when QRZ is missing or limited.
    let fcc = null;
    if (US_CALL.test(call) && (!qrz || !qrz.subscriber)) {
      try { fcc = await callookLookup(call); } catch (e) { console.warn('[lookup] callook:', e.message); }
    }
    if (!qrz && !fcc) return { call, notFound: true, qrz: qrzConfigured(), warning };
    const merged = { ...(fcc || {}), ...(qrz ? stripEmpty(qrz) : {}) };
    merged.sources = [qrz && (qrz.subscriber ? 'QRZ' : 'QRZ (basic)'), fcc && 'FCC via callook.info'].filter(Boolean);
    return { ...merged, warning };
  });
}

// ---------------------------------------------------------------- HTTP

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

const settle = async p => { try { return await p; } catch (e) { console.warn('[fetch]', e.message); return null; } };

async function api(route, q, res) {
  switch (route) {
    case '/api/config':
      return send(res, 200, {
        callsign: options.callsign, grid: options.grid, distance_units: options.distance_units,
        cluster: { status: cluster.status, host: options.dx_cluster_host, error: cluster.error },
        qrz: qrzConfigured(),
      });
    case '/api/repeaters': {
      const lat = num(q.get('lat')), lon = num(q.get('lon'));
      const radius = Math.min(Math.max(num(q.get('radius')) || 80, 5), 400);
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return send(res, 400, { error: 'Set a valid grid square' });
      return send(res, 200, await nearbyRepeaters({ lat, lon }, radius));
    }
    case '/api/lookup': {
      const call = String(q.get('call') || '').trim().toUpperCase();
      if (!/^[A-Z0-9/]{3,15}$/.test(call)) return send(res, 400, { error: 'Enter a valid callsign' });
      return send(res, 200, await lookupCall(call));
    }
    case '/api/solar': {
      const [hq, scales, kpData, wind, xr, al, fc] = await Promise.all(
        [hamqsl(), noaaScales(), kp(), solarWind(), xray(), alerts(), forecast3day()].map(settle));
      return send(res, 200, { hamqsl: hq, scales, kp: kpData, wind, xray: xr, alerts: al, forecast: fc, fetched: new Date().toISOString() });
    }
    case '/api/cycle':
      return send(res, 200, await solarCycle());
    case '/api/ionosondes':
      return send(res, 200, await ionosondes());
    case '/api/spots':
      return send(res, 200, { status: cluster.status, host: options.dx_cluster_host, error: cluster.error, spots: cluster.spots });
    case '/api/psk': {
      const call = String(q.get('call') || options.callsign).toUpperCase();
      const minutes = [60, 360, 1440].includes(+q.get('minutes')) ? +q.get('minutes') : 60;
      if (!/^[A-Z0-9/]{3,15}$/.test(call)) return send(res, 400, { error: 'Set a valid callsign' });
      return send(res, 200, await pskReports(call, minutes));
    }
    case '/api/map/mufd.svg':
    case '/api/map/fof2.svg':
      return send(res, 200, await propMap(route.includes('mufd') ? 'mufd' : 'fof2'), 'image/svg+xml');
    default:
      return send(res, 404, { error: 'not found' });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(route, res) {
  const rel = route === '/' ? 'index.html' : decodeURIComponent(route).replace(/^\/+/, '');
  const file = path.resolve(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(url.pathname, url.searchParams, res);
    return serveStatic(url.pathname, res);
  } catch (e) {
    console.error('[http]', e.message);
    send(res, 502, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`[ham-dashboard] listening on :${PORT} (call=${options.callsign || '-'} grid=${options.grid || '-'})`);
  cluster.start(options);
});
