'use strict';
// Who is viewing the dashboard, and whether they may change things.
//
// The panel is open to every Home Assistant user (panel_admin: false), but only
// admins may change what the whole household shares: first-run setup (the app's
// configuration) and saved paths (which drive sensors and automations).
//
// Home Assistant's ingress proxy adds the viewer's user ID to each request, and
// from Supervisor 2026.10.4 their groups too. It sets these after dropping any a
// browser sent, and only the proxy may connect (see clientAllowed in server.js),
// so they can be trusted. On older Supervisors, or for an owner outside the
// admin group, the user list from Home Assistant's WebSocket API decides.
//
// Outside Home Assistant (development) everyone is an admin. If admin status
// can't be confirmed, the answer is no.

const ADMIN_GROUP = 'system-admin';
const LIST_TTL_MS = 10 * 60_000;    // refresh the user list this often
const MISS_RETRY_MS = 60_000;       // refetch at most this often for an unknown user
const TIMEOUT_MS = 10_000;

class Users {
  constructor({ enforce, token, wsUrl, fetchList = () => fetchUsers(wsUrl, token) }) {
    this.enforce = enforce;
    this.fetchList = fetchList;
    this.list = null;       // Map id -> { admin, name }
    this.fetchedAt = 0;
    this.pending = null;
    this.lastError = null;
  }

  // { admin, name, reason }. reason says why a viewer isn't an admin.
  async viewer(req) {
    if (!this.enforce) return { admin: true, name: '', reason: null };
    const id = header(req, 'x-remote-user-id');
    const name = header(req, 'x-remote-user-display-name') || header(req, 'x-remote-user-name');
    if (!id) return { admin: false, name, reason: 'unknown' };
    const groups = header(req, 'x-remote-user-groups');
    if (groups.split(',').map(g => g.trim()).includes(ADMIN_GROUP)) return { admin: true, name, reason: null };

    const user = await this.lookup(id);
    if (user) return { admin: user.admin, name: name || user.name, reason: user.admin ? null : 'user' };
    // Groups were sent without the admin group: a regular user even if the list is down.
    if (groups) return { admin: false, name, reason: 'user' };
    return { admin: false, name, reason: 'unavailable' };
  }

  async lookup(id) {
    const age = Date.now() - this.fetchedAt;
    const stale = !this.list || age > LIST_TTL_MS || (!this.list.has(id) && age > MISS_RETRY_MS);
    if (stale) await this.refresh();
    return this.list?.get(id) || null;
  }

  refresh() {
    if (!this.pending) {
      this.pending = this.fetchList()
        .then(users => {
          this.list = new Map(users.map(u => [u.id, {
            admin: Boolean(u.is_active && (u.is_owner || (u.group_ids || []).includes(ADMIN_GROUP))),
            name: u.name || u.username || '',
          }]));
          this.lastError = null;
        })
        .catch(e => {
          this.lastError = e.message;
          console.warn('[users] could not read the Home Assistant user list:', e.message);
        })
        .finally(() => { this.fetchedAt = Date.now(); this.pending = null; });
    }
    return this.pending;
  }
}

function header(req, name) {
  return String(req.headers[name] || '').slice(0, 200);
}

// One request over Home Assistant's WebSocket API: authenticate, then
// config/auth/list (admin-only, which the Supervisor's connection is).
function fetchUsers(url, token) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error('no Supervisor token'));
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return reject(e); }
    const timer = setTimeout(() => finish(new Error('timed out')), TIMEOUT_MS);
    const finish = (err, users) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      err ? reject(err) : resolve(users);
    };
    ws.addEventListener('message', e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return finish(new Error('bad reply')); }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'config/auth/list' }));
      else if (m.type === 'auth_invalid') finish(new Error('authentication refused'));
      else if (m.type === 'result' && m.id === 1) {
        if (m.success && Array.isArray(m.result)) finish(null, m.result);
        else finish(new Error(m.error?.message || 'request refused'));
      }
    });
    ws.addEventListener('error', () => finish(new Error('connection failed')));
    ws.addEventListener('close', () => finish(new Error('connection closed')));
  });
}

module.exports = { Users, ADMIN_GROUP };
