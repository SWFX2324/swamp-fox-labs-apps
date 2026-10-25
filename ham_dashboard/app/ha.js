'use strict';
// Publishes dashboard data to Home Assistant as entities and fires events,
// through the Supervisor's proxy to the Core REST API. Active only when the
// add-on runs under Supervisor (it has a Supervisor token). HA_API_URL can
// point at a mock server for local testing.

const fs = require('fs');

// s6-overlay starts the app with a cleaned environment, so the token Supervisor
// gives the container is often only in s6's saved copy of the environment.
function supervisorToken() {
  if (process.env.SUPERVISOR_TOKEN) return process.env.SUPERVISOR_TOKEN;
  for (const dir of ['/run/s6/container_environment', '/var/run/s6/container_environment']) {
    for (const name of ['SUPERVISOR_TOKEN', 'HASSIO_TOKEN']) {
      try {
        const token = fs.readFileSync(`${dir}/${name}`, 'utf8').trim();
        if (token) return token;
      } catch { /* not there */ }
    }
  }
  return process.env.HASSIO_TOKEN || '';
}

const TOKEN = supervisorToken();
const BASE = process.env.HA_API_URL || 'http://supervisor/core/api';
const ATTRIBUTION = 'Ham Radio Dashboard (Swamp Fox Labs)';
const REPUBLISH_MS = 30 * 60_000;

class HomeAssistant {
  constructor() {
    this.available = Boolean(TOKEN || process.env.HA_API_URL);
    this.enabled = false;
    this.lastError = null;
    this.lastPublish = null;
    this.entities = 0;
    this.sent = new Map(); // entity_id -> { key, at }
  }

  start(enabled) {
    this.enabled = enabled && this.available;
    if (enabled && !this.available) console.log('[ha] not running under Supervisor, Home Assistant sensors are off');
  }

  async request(path, body) {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Home Assistant ${path} returned HTTP ${r.status}`);
  }

  // Skips unchanged states, but re-sends every 30 minutes so entities come back
  // after a Home Assistant restart (states set over the API aren't persisted).
  async setState(entityId, state, attributes = {}) {
    if (!this.enabled) return;
    const value = state === null || state === undefined || Number.isNaN(state) ? 'unknown' : String(state);
    const attrs = { attribution: ATTRIBUTION, ...attributes };
    const key = JSON.stringify([value, attrs]);
    const prev = this.sent.get(entityId);
    if (prev && prev.key === key && Date.now() - prev.at < REPUBLISH_MS) return;
    await this.request(`/states/${entityId}`, { state: value, attributes: attrs });
    this.sent.set(entityId, { key, at: Date.now() });
  }

  // Read another entity's state (e.g. a lightning sensor). null if it doesn't exist.
  async getState(entityId) {
    if (!this.available) return null;
    const r = await fetch(`${BASE}/states/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Home Assistant /states/${entityId} returned HTTP ${r.status}`);
    return r.json();
  }

  async fireEvent(type, data) {
    if (!this.enabled) return;
    try {
      await this.request(`/events/${type}`, data);
    } catch (e) {
      this.lastError = e.message;
      console.warn(`[ha] event ${type}: ${e.message}`);
    }
  }

  // entities: [[entity_id, state, attributes], ...]. One failure doesn't stop the
  // rest. Several batches can publish independently; the count covers them all.
  async publish(entities) {
    if (!this.enabled) return;
    let ok = 0;
    for (const [id, state, attrs] of entities) {
      try { await this.setState(id, state, attrs); ok++; } catch (e) { this.lastError = e.message; }
    }
    if (ok === entities.length) this.lastError = null;
    else console.warn(`[ha] published ${ok}/${entities.length} entities: ${this.lastError}`);
    this.entities = this.sent.size;
    this.lastPublish = new Date().toISOString();
  }

  status() {
    return { available: this.available, enabled: this.enabled, entities: this.entities, lastPublish: this.lastPublish, error: this.lastError };
  }
}

module.exports = { HomeAssistant };
