'use strict';
// End-to-end: starts the real server against fake outside services
// (fixtures/fake-services.js) and checks every endpoint, the security rules
// and that PSKReporter data survives a restart. Runs in its own temp folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '../app/server.js');
const FAKES = path.join(__dirname, 'fixtures/fake-services.js');
const VERSION = '9.9.9-test';
const QTH = 'lat=34.1458&lon=-116.0417';

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function start(env = {}, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hame2e-'))) {
  const port = await freePort();
  const options = path.join(tmp, 'options.json');
  fs.writeFileSync(options, JSON.stringify({ station_type: 'amateur', callsign: 'KR4FCD', grid: 'DM14xd', distance_units: 'mi', pota_alert_radius: 100 }));
  const child = spawn(process.execPath, ['--require', FAKES, SERVER], {
    env: {
      ...process.env, PORT: String(port), OPTIONS_FILE: options, APP_VERSION: VERSION,
      HA_SENSORS: 'false', DX_CLUSTER: 'false', APRS: 'false', TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/config`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return { child, base, tmp, log: () => log };
}

const stop = s => new Promise(resolve => { s.child.once('exit', resolve); s.child.kill('SIGTERM'); });
const getJson = async (s, p, opts) => { const r = await fetch(s.base + p, opts); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };

test('end to end against fake services', async t => {
  const s = await start();
  t.after(() => stop(s));

  await t.test('page, versioned assets, security headers and gzip', async () => {
    const r = await fetch(`${s.base}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, new RegExp(`app\\.js\\?v=${VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const js = await fetch(`${s.base}/app.js?v=${VERSION}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(js.headers.get('content-encoding'), 'gzip');
    assert.match(js.headers.get('cache-control'), /immutable/);
  });

  await t.test('config and space weather', async () => {
    const c = await getJson(s, '/api/config');
    assert.equal(c.body.callsign, 'KR4FCD');
    assert.equal(c.body.version, VERSION);
    const solar = await getJson(s, '/api/solar');
    assert.equal(solar.status, 200);
    assert.ok(Number.isFinite(solar.body.hamqsl.sfi), 'solar flux parsed');
    assert.ok(solar.body.scales?.current, 'NOAA scales parsed');
    assert.ok(solar.body.kp.length > 0, 'Kp parsed');
    const iono = await getJson(s, '/api/ionosondes');
    assert.ok(iono.body.length > 5, 'ionosondes parsed');
    const cycle = await getJson(s, '/api/cycle');
    assert.ok(cycle.body.observed.length > 100);
  });

  await t.test('measured activity and VHF openings', async () => {
    const act = await getJson(s, `/api/activity?${QTH}`);
    assert.ok(act.body.bands['20m'].stations >= 1);
    const vhf = await getJson(s, `/api/vhf?${QTH}`);
    assert.equal(vhf.body.bands['6m'].status, 'open');
  });

  await t.test('propagation: path, beacons, time signals', async () => {
    const p = await getJson(s, `/api/path?${QTH}&target=JO31`);
    assert.equal(p.status, 200);
    assert.equal(p.body.short.hours.length, 24);
    assert.ok(p.body.anchorStations > 0, 'model anchored to ionosondes');
    const prefix = await getJson(s, `/api/path?${QTH}&target=JA1ABC`);
    assert.equal(prefix.body.target.approximate, true);
    const bad = await getJson(s, `/api/path?${QTH}&target=%3Cscript%3E`);
    assert.equal(bad.status, 400);
    const b = await getJson(s, `/api/beacons?${QTH}`);
    assert.equal(b.body.beacons.length, 18);
    const ts = await getJson(s, `/api/timesignals?${QTH}`);
    assert.deepEqual(ts.body.stations.map(x => x.call), ['WWV', 'WWVH']);
  });

  await t.test('satellites, POTA, repeaters, lookup, storm', async () => {
    const sats = await getJson(s, `/api/satellites?${QTH}`);
    assert.ok(sats.body.sats.length >= 5);
    const pota = await getJson(s, '/api/pota');
    assert.ok(Array.isArray(pota.body.spots) && pota.body.spots.length > 0);
    const rpt = await getJson(s, `/api/repeaters?${QTH}&radius=150`);
    assert.equal(rpt.status, 200);
    const look = await getJson(s, '/api/lookup?call=W1AW');
    assert.equal(look.status, 200);
    const storm = await getJson(s, '/api/storm');
    assert.match(storm.body.level, /^(safe|caution|danger)$/);
  });

  await t.test('status and accuracy', async () => {
    const st = await getJson(s, '/api/status');
    assert.equal(st.body.version, VERSION);
    assert.equal(st.body.sources.find(x => x.name === 'HamQSL').state, 'ok');
    assert.ok('apparmor' in st.body.live);
    const acc = await getJson(s, '/api/accuracy');
    assert.ok(acc.body.week && acc.body.all);
  });

  await t.test('writes need same-origin JSON', async () => {
    const body = JSON.stringify({ label: 'Test path', target: { lat: 51, lon: 0, label: 'JO01' } });
    const plain = await getJson(s, '/api/paths', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
    assert.equal(plain.status, 403);
    const cross = await getJson(s, '/api/paths', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body });
    assert.equal(cross.status, 403);
    const ok = await getJson(s, '/api/paths', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.paths[0].id, 'test_path');
    const del = await getJson(s, '/api/paths?id=test_path', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(del.body.paths, []);
  });

  await t.test('no call reached a real outside service', () => {
    assert.doesNotMatch(s.log(), /UNMOCKED/);
  });
});

// As inside Home Assistant: the viewer comes from the ingress proxy's headers,
// and there's no Supervisor to ask, so only the groups header makes an admin.
test('only Home Assistant admins change setup and saved paths', async t => {
  const s = await start({ INGRESS_ONLY: 'true', SUPERVISOR_TOKEN: '' });
  t.after(() => stop(s));
  const json = { 'Content-Type': 'application/json' };
  const admin = { ...json, 'X-Remote-User-Id': 'a1', 'X-Remote-User-Groups': 'system-admin,system-users' };
  const user = { ...json, 'X-Remote-User-Id': 'u1', 'X-Remote-User-Groups': 'system-users' };
  const body = JSON.stringify({ label: 'Test path', target: { lat: 51, lon: 0, label: 'JO01' } });

  const cfg = await getJson(s, '/api/config', { headers: user });
  assert.equal(cfg.body.viewer.admin, false);
  assert.equal((await getJson(s, '/api/config', { headers: admin })).body.viewer.admin, true);

  for (const headers of [json, user, { ...json, 'X-Remote-User-Id': 'u2' }]) {
    const r = await getJson(s, '/api/paths', { method: 'POST', headers, body });
    assert.equal(r.status, 403);
    assert.equal(r.body.admin_only, true);
  }
  assert.equal((await getJson(s, '/api/setup', { method: 'POST', headers: user, body: '{"skip":true}' })).status, 403);
  assert.equal((await getJson(s, '/api/paths?id=test_path', { method: 'DELETE', headers: user })).status, 403);
  // Reading is open to everyone.
  assert.equal((await getJson(s, '/api/paths', { headers: user })).status, 200);

  const ok = await getJson(s, '/api/paths', { method: 'POST', headers: admin, body });
  assert.equal(ok.status, 200);
  assert.equal((await getJson(s, '/api/paths?id=test_path', { method: 'DELETE', headers: admin })).body.paths.length, 0);
});

// Windows can't deliver SIGTERM to a child process, so the save-on-shutdown
// path only runs on Linux (CI).
test('PSKReporter data survives a restart', { skip: process.platform === 'win32' && 'needs SIGTERM (Linux)' }, async () => {
  const first = await start();
  const before = await getJson(first, `/api/vhf?${QTH}`);
  assert.equal(before.body.bands['6m'].status, 'open');
  await stop(first);
  assert.ok(fs.existsSync(path.join(first.tmp, 'cache.json')), 'cache saved on shutdown');

  // PSKReporter now refuses every request: the data must come from the saved copy.
  const second = await start({ FAKE_PSK: '429' }, first.tmp);
  try {
    const after = await getJson(second, `/api/vhf?${QTH}`);
    assert.equal(after.body.bands['6m'].status, 'open');
    assert.match(second.log(), /restored \d+ recent PSKReporter result/);
  } finally { await stop(second); }
});
