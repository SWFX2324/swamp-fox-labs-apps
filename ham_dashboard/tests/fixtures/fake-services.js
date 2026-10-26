'use strict';
// Preloaded into the server for the end-to-end tests (node --require). Every
// call to an outside service is answered from a captured fixture, so the tests
// never touch the real services. Time-sensitive data is shifted to "now".
// A call with no fixture is refused and logged as UNMOCKED, so a new data
// source can't slip in untested.
//
// FAKE_PSK=429 makes PSKReporter answer "rate limited", to test restarts.

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const json = f => JSON.parse(read(f));
const pad = n => String(n).padStart(2, '0');
const isoNoZ = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

// A small 6 m sporadic-E opening heard near DM14, plus some HF and 2 m.
function pskXml() {
  const now = Math.floor(Date.now() / 1000) - 120;
  const rr = (tx, txGrid, rx, rxGrid, hz, mode = 'FT8') =>
    `<receptionReport receiverCallsign="${rx}" receiverLocator="${rxGrid}" senderCallsign="${tx}" senderLocator="${txGrid}" frequency="${hz}" flowStartSeconds="${now}" mode="${mode}" sNR="-12" senderDXCC="United States" />`;
  return '<receptionReports>' + [
    rr('W5ABC', 'EM12kx', 'K6RX', 'DM13ja', 50313500), rr('K5XYZ', 'EM13', 'K6RX', 'DM13ja', 50314200),
    rr('W4QQQ', 'EM73', 'W6RX', 'DM04', 50313900), rr('K9BIG', 'EN52', 'W6RX', 'DM04', 50313700),
    rr('K7TRO', 'CN85', 'K6RX', 'DM13ja', 144174000), rr('DL1AA', 'JO31', 'K6RX', 'DM13ja', 14074000),
    rr('JA1AA', 'PM95', 'W6RX', 'DM04', 14075000), rr('W1HF', 'FN31', 'K6RX', 'DM13ja', 7074000),
  ].join('') + '</receptionReports>';
}

function kc2g() {
  // Fresh readings, so the server's "last 3 hours" filter keeps them.
  const t = isoNoZ(new Date(Date.now() - 10 * 60_000));
  return JSON.stringify(json('kc2g-stations.json').map(s => ({ ...s, time: t, cs: s.cs > 0 ? s.cs : 70 })));
}

function nwsHourly() {
  const h = json('nws-hourly.json');
  const start = Math.ceil(Date.now() / 3600_000) * 3600_000;
  h.properties.periods = h.properties.periods.map((p, i) => ({
    ...p, startTime: new Date(start + i * 3600_000).toISOString(), endTime: new Date(start + (i + 1) * 3600_000).toISOString(),
  }));
  return JSON.stringify(h);
}

const ROUTES = [
  [/hamqsl\.com\/solarxml/, () => read('hamqsl.xml')],
  [/noaa-scales\.json/, () => read('noaa-scales.json')],
  [/noaa-planetary-k-index-forecast/, () => read('kp-forecast.json')],
  [/solar-wind-speed/, () => read('solar-wind-speed.json')],
  [/solar-wind-mag-field/, () => read('solar-wind-mag.json')],
  [/10cm-flux/, () => read('10cm-flux.json')],
  [/xrays-6-hour/, () => read('xrays-6-hour.json')],
  [/products\/alerts\.json/, () => read('alerts.json')],
  [/3-day-forecast/, () => read('3-day-forecast.txt')],
  [/observed-solar-cycle-indices/, () => read('cycle-observed.json')],
  [/predicted-solar-cycle/, () => read('cycle-predicted.json')],
  [/kc2g\.com\/api\/stations/, kc2g],
  [/kc2g\.com\/renders\//, () => read('map.svg')],
  [/api\.pota\.app\/spot/, () => read('pota.json')],
  [/celestrak\.org/, () => read('celestrak.tle')],
  [/api\.weather\.gov\/alerts/, () => read('nws-alerts.json')],
  [/api\.weather\.gov\/points/, () => read('nws-point.json')],
  [/api\.weather\.gov\/gridpoints\/.*\/forecast\/hourly/, nwsHourly],
  [/hearham\.com\/api\/repeaters/, () => read('hearham.json')],
  [/callook\.info\//, () => read('callook-W1AW.json')],
  [/pskreporter\.info/, () => (process.env.FAKE_PSK === '429' ? { status: 429, body: 'slow down' } : pskXml())],
];

global.fetch = async url => {
  const u = String(url);
  const route = ROUTES.find(([re]) => re.test(u));
  if (!route) {
    console.error(`UNMOCKED ${u}`);
    throw new Error(`no fixture for ${u}`);
  }
  const out = route[1]();
  return typeof out === 'string' ? new Response(out, { status: 200 }) : new Response(out.body, { status: out.status });
};
