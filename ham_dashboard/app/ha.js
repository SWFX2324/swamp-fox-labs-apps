'use strict';
// Publishes dashboard data to Home Assistant as entities and fires events.
//
// Two ways to create entities:
//  - MQTT discovery (preferred): when the Mosquitto broker app is installed,
//    entities are registered under one "Ham Radio" device with unique IDs, so
//    they can be renamed and they keep their state across HA restarts.
//  - The Core REST API (fallback): plain states, no device, lost on restart
//    until the next update.
// Events and reading other entities always use the REST API.
//
// Active only under Supervisor (it has a Supervisor token). For local testing,
// HA_API_URL points at a mock Core API and MQTT_URL at a broker.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MqttClient } = require('./mqtt');

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
const SUPERVISOR = process.env.SUPERVISOR_URL || 'http://supervisor';
const VERSION = process.env.APP_VERSION || 'dev';
const ATTRIBUTION = 'Ham Radio Dashboard (Swamp Fox Labs)';
const REPUBLISH_MS = 30 * 60_000;

const NODE = 'ham_dashboard';
const DISCOVERY_TOPIC = `homeassistant/device/${NODE}/config`;
const AVAILABILITY_TOPIC = `${NODE}/availability`;
const STATE_FILE = path.join(fs.existsSync('/data') ? '/data' : os.tmpdir(), 'ha_entities.json');
// Config keys that belong in the MQTT discovery payload rather than in attributes.
const CONFIG_KEYS = ['friendly_name', 'icon', 'unit_of_measurement', 'device_class', 'state_class'];

class HomeAssistant {
  constructor() {
    this.available = Boolean(TOKEN || process.env.HA_API_URL);
    this.token = TOKEN; // also used for the app's own /addons/self/* calls
    this.enabled = false;
    this.mode = null; // 'mqtt' | 'rest'
    this.lastError = null;
    this.lastPublish = null;
    this.entities = 0;
    this.sent = new Map(); // entity_id -> { key, at } (REST dedupe)
    this.components = {};  // MQTT discovery components by key
    this.mqttStates = {};  // key -> { state, attrs, sentKey }
    this.saved = this.load();
  }

  load() {
    try { return { mqtt: false, cleared: [], keys: [], ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { return { mqtt: false, cleared: [], keys: [] }; }
  }

  save() {
    fs.writeFile(STATE_FILE, JSON.stringify(this.saved), err => err && console.warn('[ha] state file:', err.message));
  }

  async start({ enabled, mqtt }) {
    this.enabled = enabled && this.available;
    if (enabled && !this.available) console.log('[ha] not running under Supervisor, Home Assistant sensors are off');
    if (!this.enabled) return;

    const service = mqtt || this.saved.mqtt ? await this.mqttService() : null;
    if (mqtt && service) {
      // Once a broker app exists, stay in MQTT mode even if it's briefly down
      // (the client keeps retrying), so entity types never get mixed.
      this.mode = 'mqtt';
      this.startedAt = Date.now();
      try {
        await this.startMqtt(service);
        console.log(`[ha] publishing entities through MQTT discovery (${service.host}:${service.port})`);
      } catch (e) {
        this.lastError = `MQTT: ${e.message}`;
        console.warn(`[ha] can't reach the MQTT broker yet (${e.message}), retrying`);
      }
      return;
    }
    if (mqtt) console.log('[ha] no MQTT broker app found, publishing entities through the REST API');
    this.mode = 'rest';
    if (this.saved.mqtt) await this.removeMqttDevice(service);
  }

  // Broker details from Supervisor's services API (Mosquitto app), or MQTT_URL.
  async mqttService() {
    if (process.env.MQTT_URL) {
      const u = new URL(process.env.MQTT_URL);
      return { host: u.hostname, port: u.port || 1883, ssl: u.protocol === 'mqtts:', username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
    }
    try {
      const r = await fetch(`${SUPERVISOR}/services/mqtt`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const j = await r.json();
      return j.result === 'ok' && j.data?.host ? j.data : null;
    } catch {
      return null;
    }
  }

  async startMqtt(service) {
    this.mqtt = new MqttClient({
      ...service,
      clientId: `${NODE}_${Math.random().toString(16).slice(2, 10)}`,
      will: { topic: AVAILABILITY_TOPIC, payload: 'offline', retain: true },
    });
    this.mqtt.onConnect = () => this.mqttResend();
    await this.mqtt.start();
  }

  // After every (re)connect: availability, the device config, and all states.
  mqttResend() {
    this.mqtt.publish(AVAILABILITY_TOPIC, 'online', { retain: true });
    if (Object.keys(this.components).length) this.publishDiscovery();
    for (const key of Object.keys(this.mqttStates)) this.mqttStates[key].sentKey = null;
    this.flushMqttStates();
  }

  publishDiscovery() {
    const cmps = { ...this.components };
    // Remove components a previous run registered that this run no longer makes
    // (e.g. the lightning sensor option was cleared), once startup has settled.
    if (Date.now() - this.startedAt > 10 * 60_000) {
      for (const key of this.saved.keys) if (!cmps[key]) cmps[key] = { p: key.startsWith('bs_') ? 'binary_sensor' : 'sensor' };
      this.saved.keys = Object.keys(this.components);
      this.save();
    } else {
      this.saved.keys = [...new Set([...this.saved.keys, ...Object.keys(this.components)])];
      this.save();
    }
    this.mqtt.publish(DISCOVERY_TOPIC, JSON.stringify({
      dev: { ids: [NODE], name: 'Ham Radio', mf: 'Swamp Fox Labs', mdl: 'Ham Radio Dashboard', sw: VERSION },
      o: { name: 'Ham Radio Dashboard', sw: VERSION, url: 'https://github.com/SWFX2324/swamp-fox-labs-ha-apps' },
      avty_t: AVAILABILITY_TOPIC,
      cmps,
    }), { retain: true });
  }

  flushMqttStates() {
    for (const [key, s] of Object.entries(this.mqttStates)) {
      const sentKey = JSON.stringify([s.state, s.attrs]);
      if (sentKey === s.sentKey) continue;
      const ok = this.mqtt.publish(`${NODE}/${key}/attributes`, JSON.stringify(s.attrs), { retain: true }) &&
        this.mqtt.publish(`${NODE}/${key}/state`, s.state, { retain: true });
      if (ok) s.sentKey = sentKey;
    }
  }

  // Delete states an earlier REST-mode run created, so MQTT entities can take
  // the same entity IDs instead of getting a "_2" suffix. Done once per entity.
  async clearRestStates(ids) {
    for (const id of ids) {
      if (this.saved.cleared.includes(id)) continue;
      try {
        const r = await fetch(`${BASE}/states/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(10_000) });
        if (r.ok || r.status === 404) this.saved.cleared.push(id);
      } catch (e) { console.warn(`[ha] couldn't clear old state ${id}: ${e.message}`); }
    }
    this.saved.mqtt = true;
    this.save();
  }

  // Switching back to REST: remove the retained MQTT device so its entities
  // don't linger next to the REST ones.
  async removeMqttDevice(service) {
    if (!service) { console.warn('[ha] MQTT entities from an earlier run may remain; remove the "Ham Radio" device in the MQTT integration'); return; }
    try {
      const client = new MqttClient({ ...service, clientId: `${NODE}_cleanup`, retry: false });
      await client.start();
      client.publish(DISCOVERY_TOPIC, '', { retain: true });
      client.publish(AVAILABILITY_TOPIC, '', { retain: true });
      setTimeout(() => client.end(), 1000);
      this.saved = { mqtt: false, cleared: [], keys: [] };
      this.save();
      console.log('[ha] removed the MQTT "Ham Radio" device from an earlier run');
    } catch (e) { console.warn(`[ha] couldn't remove the old MQTT device: ${e.message}`); }
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

  // entities: [[entity_id, state, attributes], ...]. Several batches can publish
  // independently; the count covers them all.
  async publish(entities) {
    if (!this.enabled || !this.mode) return;
    if (this.mode === 'mqtt') return this.publishMqtt(entities);
    let ok = 0;
    for (const [id, state, attrs] of entities) {
      try { await this.setState(id, state, attrs); ok++; } catch (e) { this.lastError = e.message; }
    }
    if (ok === entities.length) this.lastError = null;
    else console.warn(`[ha] published ${ok}/${entities.length} entities: ${this.lastError}`);
    this.entities = this.sent.size;
    this.lastPublish = new Date().toISOString();
  }

  async publishMqtt(entities) {
    const added = [];
    for (const [id, state, attrs = {}] of entities) {
      const [domain, objectId] = id.split('.');
      // Binary sensor keys get a prefix so a later cleanup knows their platform.
      const key = (domain === 'binary_sensor' ? 'bs_' : '') + objectId.replace(/^ham_/, '');
      const extra = Object.fromEntries(Object.entries(attrs).filter(([k]) => !CONFIG_KEYS.includes(k)));
      const cfg = {
        p: domain, unique_id: `${NODE}_${key}`, default_entity_id: id, name: attrs.friendly_name,
        state_topic: `${NODE}/${key}/state`, json_attributes_topic: `${NODE}/${key}/attributes`,
        ...(attrs.icon && { icon: attrs.icon }),
        ...(attrs.unit_of_measurement && { unit_of_measurement: attrs.unit_of_measurement }),
        ...(attrs.device_class && { device_class: attrs.device_class }),
        ...(attrs.state_class && { state_class: attrs.state_class }),
        ...(domain === 'binary_sensor' && { payload_on: 'on', payload_off: 'off' }),
      };
      if (JSON.stringify(this.components[key]) !== JSON.stringify(cfg)) {
        if (!this.components[key]) added.push(id);
        this.components[key] = cfg;
        this.discoveryDirty = true;
      }
      const missing = state === null || state === undefined || Number.isNaN(state) || state === 'unknown';
      this.mqttStates[key] = { ...this.mqttStates[key], state: missing ? 'None' : String(state), attrs: { attribution: ATTRIBUTION, ...extra } };
    }
    if (added.length) await this.clearRestStates(added);
    if (this.discoveryDirty && this.mqtt.connected) {
      this.publishDiscovery();
      this.discoveryDirty = false;
      // Give Home Assistant a moment to set up new entities before their states arrive.
      if (added.length) await new Promise(r => setTimeout(r, 1500));
    }
    this.flushMqttStates();
    this.entities = Object.keys(this.components).length;
    this.lastPublish = new Date().toISOString();
    this.lastError = this.mqtt.connected ? null : `MQTT: ${this.mqtt.error || 'not connected'}`;
  }

  status() {
    return {
      available: this.available, enabled: this.enabled, mode: this.mode,
      entities: this.entities, lastPublish: this.lastPublish, error: this.lastError,
    };
  }
}

module.exports = { HomeAssistant };
