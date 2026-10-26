'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Users } = require('../app/users');

const req = headers => ({ headers });
const LIST = [
  { id: 'a1', name: 'Admin', is_active: true, is_owner: false, group_ids: ['system-admin'] },
  { id: 'o1', name: 'Owner', is_active: true, is_owner: true, group_ids: ['system-users'] },
  { id: 'u1', name: 'Kid', is_active: true, is_owner: false, group_ids: ['system-users'] },
  { id: 'x1', name: 'Gone', is_active: false, is_owner: false, group_ids: ['system-admin'] },
];
const counting = list => {
  const f = async () => { f.calls++; if (list instanceof Error) throw list; return list; };
  f.calls = 0;
  return f;
};

test('outside Home Assistant everyone is an admin', async () => {
  const u = new Users({ enforce: false, fetchList: counting(LIST) });
  assert.equal((await u.viewer(req({}))).admin, true);
});

test('no user header: not an admin', async () => {
  const u = new Users({ enforce: true, fetchList: counting(LIST) });
  assert.deepEqual(await u.viewer(req({})), { admin: false, name: '', reason: 'unknown' });
});

test('the groups header decides admins without a lookup', async () => {
  const f = counting(LIST);
  const u = new Users({ enforce: true, fetchList: f });
  const v = await u.viewer(req({ 'x-remote-user-id': 'zz', 'x-remote-user-groups': 'system-users,system-admin', 'x-remote-user-display-name': 'Pat' }));
  assert.deepEqual(v, { admin: true, name: 'Pat', reason: null });
  assert.equal(f.calls, 0);
});

test('the user list decides on older Supervisors, and is cached', async () => {
  const f = counting(LIST);
  const u = new Users({ enforce: true, fetchList: f });
  assert.equal((await u.viewer(req({ 'x-remote-user-id': 'a1' }))).admin, true);
  assert.equal((await u.viewer(req({ 'x-remote-user-id': 'o1' }))).admin, true, 'owner');
  assert.deepEqual(await u.viewer(req({ 'x-remote-user-id': 'u1' })), { admin: false, name: 'Kid', reason: 'user' });
  assert.equal((await u.viewer(req({ 'x-remote-user-id': 'x1' }))).admin, false, 'inactive');
  assert.equal(f.calls, 1);
  // An unknown user doesn't refetch again within a minute.
  await u.viewer(req({ 'x-remote-user-id': 'new' }));
  assert.equal(f.calls, 1);
});

test('an owner outside the admin group is still an admin', async () => {
  const u = new Users({ enforce: true, fetchList: counting(LIST) });
  assert.equal((await u.viewer(req({ 'x-remote-user-id': 'o1', 'x-remote-user-groups': 'system-users' }))).admin, true);
});

test('when the user list fails, the answer is no', async () => {
  const u = new Users({ enforce: true, fetchList: counting(new Error('down')) });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await u.viewer(req({ 'x-remote-user-id': 'a1' })), { admin: false, name: '', reason: 'unavailable' });
    assert.equal((await u.viewer(req({ 'x-remote-user-id': 'a1', 'x-remote-user-groups': 'system-users' }))).reason, 'user');
    assert.equal(u.lastError, 'down');
  } finally { console.warn = warn; }
});
