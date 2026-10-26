'use strict';
// Guards against cross-site scripting. Data from outside the app (APRS
// comments, DX cluster spots, QRZ records, POTA notes, PSKReporter reports) is
// shown on the dashboard, so it must always go through esc() (or a helper that
// escapes) before it becomes HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8');

test('esc() neutralizes HTML and attribute injection', () => {
  const line = APP.split('\n').find(l => /^\s*const esc = /.test(l));
  assert.ok(line, 'esc() is defined');
  const esc = new Function(`${line.trim()} return esc;`)();
  const evil = `<img src=x onerror="alert('x')">&`;
  const out = esc(evil);
  assert.equal(out, '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  assert.doesNotMatch(out, /[<>"']/);
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

// Fields that carry text from outside the app.
const OUTSIDE = new Set([
  'comment', 'comments', 'status', 'name', 'park', 'location', 'place', 'title', 'message', 'headline',
  'description', 'city', 'state', 'group', 'node', 'country', 'call', 'callsign', 'dx', 'spotter', 'activator',
  'reference', 'tx', 'rx', 'mode', 'note', 'forecast', 'event', 'label', 'nickname', 'aliases', 'qslmgr',
  'timezone', 'image', 'url', 'uls', 'error', 'warning', 'restriction', 'power', 'source', 'area', 'owner',
  'txGrid', 'rxGrid', 'grid', 'txCountry', 'rxCountry', 'server', 'host', 'places',
]);

// A bare property path like ${s.comment} or ${r?.name}, inside a line that
// builds HTML (has a tag or an attribute value), is unescaped outside data.
function unescapedOutsideData(src) {
  const found = [];
  src.split('\n').forEach((line, i) => {
    if (!/<[a-z/]|="\$\{/.test(line)) return;
    for (const m of line.matchAll(/\$\{\s*([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)\s*\}/g)) {
      const field = m[1].split(/\??\./).pop();
      if (OUTSIDE.has(field)) found.push(`app.js:${i + 1}: \${${m[1]}}`);
    }
  });
  return found;
}

test('outside data is never put into HTML unescaped', () => {
  assert.deepEqual(unescapedOutsideData(APP), [], 'wrap these in esc(), or use a helper that escapes');
});

test('the scan catches an unescaped field', () => {
  assert.deepEqual(unescapedOutsideData('el.innerHTML = `<td>${s.comment}</td>`;'), ['app.js:1: ${s.comment}']);
  assert.deepEqual(unescapedOutsideData('el.innerHTML = `<td>${esc(s.comment)}</td>`;'), []);
  assert.deepEqual(unescapedOutsideData('el.textContent = `${s.comment}`;'), []);
});
