'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCache } = require('../app/cache');
const { SourceStatus } = require('../app/status');

const MIN = 60_000;
const quiet = { warn() {} };
const clock = (t = 1_000_000) => ({ now: () => t, set: v => { t = v; }, add: ms => { t += ms; } });
const httpError = (status, msg = `HTTP ${status}`) => Object.assign(new Error(msg), { status });

test('serves fresh copies and shares one request between callers', async () => {
  const c = clock();
  const cache = createCache({ now: c.now, log: quiet });
  let calls = 0;
  const fetch = () => { calls++; return Promise.resolve(calls); };
  const [a, b] = await Promise.all([cache.cached('k', MIN, fetch), cache.cached('k', MIN, fetch)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(calls, 1);
  c.add(30_000);
  assert.equal(await cache.cached('k', MIN, fetch), 1);
  c.add(31_000);
  assert.equal(await cache.cached('k', MIN, fetch), 2);
});

test('a rate limit backs off 15 minutes and serves the old copy', async () => {
  const c = clock();
  const cache = createCache({ now: c.now, log: quiet });
  await cache.cached('psk', 5 * MIN, () => Promise.resolve('old'));
  c.add(6 * MIN);
  let calls = 0;
  const limited = () => { calls++; return Promise.reject(httpError(429)); };
  assert.equal(await cache.cached('psk', 5 * MIN, limited), 'old');
  c.add(10 * MIN);
  assert.equal(await cache.cached('psk', 5 * MIN, limited), 'old');
  assert.equal(calls, 1, 'no new request during the back-off');
  c.add(6 * MIN);
  assert.equal(await cache.cached('psk', 5 * MIN, () => Promise.resolve('new')), 'new');
});

test('a failure with nothing cached rejects, and the next call retries', async () => {
  const cache = createCache({ log: quiet });
  await assert.rejects(cache.cached('x', MIN, () => Promise.reject(new Error('down'))), /down/);
  assert.equal(await cache.cached('x', MIN, () => Promise.resolve(7)), 7);
});

test('rate limited with nothing cached says so without asking again', async () => {
  const c = clock();
  const cache = createCache({ now: c.now, log: quiet });
  await assert.rejects(cache.cached('psk-area-DM', 5 * MIN, () => Promise.reject(httpError(429))));
  let asked = false;
  await assert.rejects(cache.cached('psk-area-DM', 5 * MIN, () => { asked = true; return Promise.resolve(1); }), /rate limited/);
  assert.equal(asked, false);
});

test('sweep drops entries long past their lifetime and caps the size', async () => {
  const c = clock();
  const cache = createCache({ now: c.now, maxEntries: 3, keepMs: 60 * MIN, log: quiet });
  for (const k of ['a', 'b', 'c', 'd', 'e']) { await cache.cached(k, MIN, () => Promise.resolve(k)); c.add(1000); }
  cache.sweep();
  assert.deepEqual([...cache.entries.keys()], ['c', 'd', 'e']);
  c.add(61 * MIN);
  await cache.cached('f', MIN, () => Promise.resolve('f'));
  cache.sweep();
  assert.deepEqual([...cache.entries.keys()], ['f']);
});

test('PSKReporter results and back-off survive a restart', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hamcache-')), 'cache.json');
  const c = clock();
  const a = createCache({ now: c.now, persist: /^psk-/, persistFile: file, log: quiet });
  await a.cached('psk-area-DM', 5 * MIN, () => Promise.resolve({ reports: [1, 2] }));
  await a.cached('hamqsl', 30 * MIN, () => Promise.resolve('not saved'));
  await assert.rejects(a.cached('psk-area-PM', 5 * MIN, () => Promise.reject(httpError(429))));
  a.save();

  // A new process two minutes later.
  c.add(2 * MIN);
  const b = createCache({ now: c.now, persist: /^psk-/, persistFile: file, log: quiet });
  assert.equal(b.load(), 1);
  let asked = 0;
  const fetch = () => { asked++; return Promise.resolve('fetched'); };
  assert.deepEqual(await b.cached('psk-area-DM', 5 * MIN, fetch), { reports: [1, 2] });
  assert.equal(asked, 0, 'restored copy is still fresh');
  await assert.rejects(b.cached('psk-area-PM', 5 * MIN, fetch), /rate limited/);
  assert.equal(asked, 0, 'back-off carried over');
  assert.equal(b.entries.has('hamqsl'), false);

  // Too old to restore.
  c.add(40 * MIN);
  const d = createCache({ now: c.now, persist: /^psk-/, persistFile: file, log: quiet });
  assert.equal(d.load(), 0);
});

test('source status keeps at most 200 keys', () => {
  const s = new SourceStatus();
  for (let i = 0; i < 250; i++) s.note(`psk-area-F${i}`, null, i);
  assert.equal(s.keys.size, 200);
  assert.equal(s.keys.has('psk-area-F0'), false);
  assert.equal(s.keys.has('psk-area-F249'), true);
});
