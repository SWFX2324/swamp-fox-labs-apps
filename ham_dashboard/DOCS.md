# Ham Radio Dashboard

A read-only propagation, space-weather and station-lookup dashboard for amateur radio
operators. It adds a **Ham Radio** panel to the Home Assistant sidebar, with six
tabs: **Space weather**, **Repeaters**, **APRS**, **POTA**, **Satellites** and
**Callsign lookup**. It also publishes its data to Home Assistant as sensors and
fires events you can use in automations (see [Home Assistant sensors and alerts](#home-assistant-sensors-and-alerts)).

## Space weather

- **Solar & geomagnetic conditions** – SFI, sunspot number, A and K index, X-ray flux,
  solar wind speed, Bz and estimated noise floor.
- **NOAA space weather scales** – current R (radio blackout), S (radiation) and G
  (geomagnetic) levels, yesterday's maximum and the 3-day probability forecast.
- **HF band conditions, 80 m – 6 m**
  - *HamQSL* day/night ratings by N0NBH.
  - *At your QTH now* – a local estimate that compares each band with the MUF(3000)
    measured by the nearest ionosonde (within 3000 km, last 3 hours), adjusted for
    daytime D-layer absorption on 80/60/40 m and for geomagnetic storms.
  - *Heard nearby* – measured activity: how many distinct stations PSKReporter
    monitors within about 500 miles of you decoded on each band in the last 15
    minutes (mostly FT8/FT4), how many of them were DX (over about 1,550 miles
    away), and the farthest one. Zero can also mean nobody nearby is listening on
    that band. Updated every 5 minutes.
  - VHF: aurora and sporadic-E status.
- **Station storm safety** – a Safe / Caution / Danger status for your station,
  with a red banner on every tab when it's Danger. It combines:
  - National Weather Service alerts for your grid square (US only). Severe
    thunderstorm, tornado and extreme wind warnings mean Danger. Watches, and
    special weather statements about thunderstorms, mean Caution.
  - The NWS hourly forecast: thunderstorms expected within 3 hours mean Caution.
  - An optional lightning sensor in Home Assistant (Ecowitt WH57, Ambient Weather,
    ESPHome AS3935 and similar). A strike within `lightning_alert_distance` in the
    last 30 minutes means Danger, and within twice that distance means Caution.
- **Maps** – live gray line (day/night/twilight) with sunrise, sunset and gray-line
  times at your QTH, plus the KC2G MUF and foF2 maps.
- **Kp chart** – the past 4 days and the 3-day forecast.
- **Solar cycle** – monthly sunspot number since 2008 and the NOAA prediction.
- **DX cluster spots** – live telnet feed, filterable by band, mode and the
  spotter's continent.
- **Who's hearing you** – PSKReporter reception reports for your callsign, plotted
  on the gray line map.
- **NOAA alerts, watches and warnings** from the last 72 hours, plus the full 3-day
  forecast text.

## Repeaters

Repeaters near your grid square, from the community-maintained
[HearHam](https://hearham.com/) directory.

- A map centred on your QTH with range rings. Hover a dot for the repeaters at that
  site, and click it to jump to the row in the list.
- A list sorted by distance, with output frequency, offset (hover it for the input
  frequency), CTCSS tone or DMR color code, mode, linked network (AllStar, IRLP,
  EchoLink, DMR) and on-air status.
- Filters for band, mode, search radius, on-air only, and callsign/city search.
- Links to each repeater's HearHam and RepeaterBook pages.

The add-on downloads the HearHam directory at most once a day and keeps a copy in
its data folder, so the list keeps working across restarts and changing your grid
updates it instantly. Listings can be out of date, so confirm frequency and tone
before you transmit.

## APRS

Live APRS activity around you, received directly from the
[APRS-IS](https://www.aprs2.net/) network. The add-on keeps one receive-only
connection (it never transmits), filtered to `aprs_radius` around the add-on's grid
square.

- A map with range rings showing mobiles, fixed stations, digipeaters and iGates,
  weather stations and objects. Moving stations show a heading tick and their recent
  track. Hover a station for speed, altitude, path and comment, and click it to
  find it in the list.
- A list of stations heard in the last 15 minutes, hour or 3 hours, filterable by
  type and searchable. Each one links to its aprs.fi page, and callsigns open a
  lookup.
- Local weather stations (APRS and CWOP) with temperature, wind, humidity, pressure
  and rain.

Stations are dropped after 3 hours without a packet. The feed follows the add-on's
grid square; changing the grid in a browser moves the map but not the feed.

## POTA

Parks on the Air activators on the air right now, from [pota.app](https://pota.app/).

- A world map with the live gray line, colored by mode (CW, phone, digital).
  Activators who've gone QRT show hollow.
- A list with frequency, band, mode, park, distance and direction, filterable by
  band, mode and distance, and sortable by newest or nearest. Park references link
  to the park's pota.app page, and callsigns open a lookup.

Spots refresh every minute while the tab is open. SOTA isn't included: the SOTA API
only allows approved applications.

## Satellites

Pass predictions for your grid square over the next 24 hours, for popular FM and
linear amateur satellites: ISS, SO-50, PO-101, AO-91, RS-44, FO-29 and AO-7.

- A list of upcoming passes with rise time, countdown, maximum elevation, direction
  and duration, filterable by FM/linear and minimum elevation. Passes in progress
  are marked **Up now**.
- A sky plot of the selected pass (the centre is straight up, the edge is the
  horizon) with rise, highest point, set and the satellite's current position.
- Doppler-corrected downlink and uplink frequencies at rise, highest point and set.
  For linear birds it shows the shift at the centre of the passband.

Orbits come from [CelesTrak](https://celestrak.org/) (downloaded twice a day) and
are computed with SGP4 using [satellite.js](https://github.com/shashwatak/satellite-js).
Satellites go on and off the air often, so check
[AMSAT live status](https://www.amsat.org/status/) before you transmit.

## Callsign lookup

Type a callsign, or click any callsign in the DX spots, PSKReporter or repeater
lists. The lookup shows name, address, grid, license class and dates, QSL methods,
the QRZ photo when there is one, and the distance, beam heading (short and long
path) and great-circle path from your QTH.

- **US callsigns** work with no setup, using FCC data from
  [callook.info](https://callook.info/).
- **Worldwide callsigns** need your QRZ.com login in the add-on options. A
  [QRZ XML Logbook Data subscription](https://www.qrz.com/page/xml_data.html) unlocks
  full details; without one, QRZ returns basic information only and US calls are
  filled in from FCC data.

Each callsign is cached for a day so repeated lookups don't hit QRZ again.

## Configuration

| Option | Description |
| --- | --- |
| `callsign` | Your callsign. Used to log in to the DX cluster and as the default for PSKReporter. |
| `grid` | Your Maidenhead grid square (4 or 6 characters, e.g. `DM14xd`). |
| `distance_units` | `mi` or `km`. |
| `dx_cluster_enabled` | Keep a telnet connection to a DX cluster for live spots. |
| `dx_cluster_host` / `dx_cluster_port` | The cluster to use. Default: `dxc.ve7cc.net:23`. |
| `qrz_username` / `qrz_password` | Optional. Your QRZ.com login, for worldwide callsign lookups. The password is only sent to QRZ and is never shown in the dashboard or logs. |
| `aprs_enabled` | Keep a receive-only APRS-IS connection for the APRS tab. Needs `callsign` and `grid`. |
| `aprs_radius` | How far around your grid to receive APRS stations, in your distance units (10–300, default 100). |
| `ha_sensors` | Publish `sensor.ham_*` and `binary_sensor.ham_*` entities and fire `ham_dashboard_*` events. On by default. |
| `spot_watch` | Callsigns or prefixes to watch on the DX cluster, e.g. `VP8PJ` or `3Y0`. Matches are highlighted in the spots table and fire a `ham_dashboard_dx_spot` event. |
| `pota_alert_radius` | Fire a `ham_dashboard_pota_spot` event for new POTA activations within this distance, in your units. `0` turns POTA alerts off. Default 100. |
| `nws_alerts` | Use National Weather Service alerts and the hourly forecast for storm safety (US only). On by default. |
| `lightning_entity` | Optional. A Home Assistant sensor whose state is the distance to the last lightning strike, e.g. `sensor.ecowitt_lightning_distance`. |
| `lightning_alert_distance` | Strikes within this distance (your units) in the last 30 minutes mean Danger. Default 15. |

`callsign`, `grid` and `distance_units` are the defaults for everyone who opens the
panel. Each person can also click the callsign/grid chip at the top right and enter
their own. That choice is saved in their browser only, so several operators can
share one Home Assistant. The QRZ login is shared by everyone using the panel.

## Home Assistant sensors and alerts

With `ha_sensors` on, the add-on updates these entities every 5 minutes, using the
add-on's `grid` for anything location-based:

| Entity | State |
| --- | --- |
| `sensor.ham_solar_flux`, `sensor.ham_sunspot_number`, `sensor.ham_a_index`, `sensor.ham_k_index` | Solar and geomagnetic indices |
| `sensor.ham_xray_flux`, `sensor.ham_solar_wind_speed`, `sensor.ham_bz`, `sensor.ham_noise_floor` | X-ray class, solar wind (km/s), Bz (nT), noise estimate |
| `sensor.ham_noaa_r_scale`, `sensor.ham_noaa_s_scale`, `sensor.ham_noaa_g_scale` | NOAA scale level, 0–5 |
| `binary_sensor.ham_radio_blackout` | On at R1 or higher |
| `binary_sensor.ham_geomagnetic_storm` | On at G1 or higher, or Kp 5+ |
| `sensor.ham_local_muf` | MUF from the nearest ionosonde (MHz) |
| `sensor.ham_band_80m` … `sensor.ham_band_6m` | `Good`, `Fair`, `Poor` or `Closed` at your QTH, with HamQSL day/night ratings as attributes |
| `sensor.ham_next_pass_iss`, `sensor.ham_next_pass_so_50`, … | Rise time of each satellite's next pass of 10° or more, with elevation, azimuths and frequencies as attributes |
| `sensor.ham_next_good_pass` | The next pass of any satellite reaching 30° or more |
| `sensor.ham_pota_nearby` | Number of POTA activators within your POTA alert radius, with the closest ten as an attribute |
| `sensor.ham_activity_80m` … `sensor.ham_activity_6m` | Stations heard nearby on that band in the last 15 minutes, with DX count and farthest station as attributes |
| `binary_sensor.ham_lightning_danger` | On when storm safety is Danger (safety device class), with the reasons as an attribute. Updated every minute. |
| `sensor.ham_storm_status` | `Safe`, `Caution` or `Danger` |
| `sensor.ham_nws_alerts` | Number of active NWS alerts for your location, with the list as an attribute |
| `sensor.ham_lightning_distance` | Distance to the last strike, when a lightning sensor is set |

It also fires events:

- `ham_dashboard_dx_spot` when a DX cluster spot matches your `spot_watch` list
  (`dx`, `frequency_khz`, `band`, `mode`, `spotter`, `comment`, `watch`).
- `ham_dashboard_pota_spot` when a new POTA activation appears within
  `pota_alert_radius` (`activator`, `reference`, `park`, `frequency_khz`, `band`,
  `mode`, `distance_km`, `bearing`).
- `ham_dashboard_storm_danger` when storm safety changes to Danger (`reasons`).

DX and POTA alerts fire at most once every 30 minutes per station and band.

These entities are created through Home Assistant's API, so they can't be renamed
in the UI, and they show as unavailable for a few minutes after Home Assistant
restarts until the next update.

### Example automations

Replace `notify.mobile_app_your_phone` with your own notify service.

```yaml
- alias: "Disconnect antennas on lightning danger"
  triggers:
    - trigger: state
      entity_id: binary_sensor.ham_lightning_danger
      to: "on"
  actions:
    # Replace with the smart plug or relay that feeds your antenna switch.
    - action: switch.turn_off
      target:
        entity_id: switch.antenna_relay
    - action: notify.mobile_app_your_phone
      data:
        message: "Lightning danger: {{ state_attr('binary_sensor.ham_lightning_danger', 'reasons') | join(', ') }}. Antennas disconnected."

- alias: "10m has DX"
  triggers:
    - trigger: numeric_state
      entity_id: sensor.ham_activity_10m
      attribute: dx_stations
      above: 3
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: "10m is open: {{ state_attr('sensor.ham_activity_10m', 'dx_stations') }} DX stations heard nearby, farthest {{ state_attr('sensor.ham_activity_10m', 'farthest_call') }}"

- alias: "10m is open"
  triggers:
    - trigger: state
      entity_id: sensor.ham_band_10m
      to: ["Good", "Fair"]
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: "10m is {{ trigger.to_state.state }} (MUF {{ states('sensor.ham_local_muf') }} MHz)"

- alias: "Geomagnetic storm"
  triggers:
    - trigger: state
      entity_id: binary_sensor.ham_geomagnetic_storm
      to: "on"
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: "Geomagnetic storm {{ state_attr('binary_sensor.ham_geomagnetic_storm', 'level') }}, Kp {{ states('sensor.ham_k_index') }}"

- alias: "POTA activator nearby"
  triggers:
    - trigger: event
      event_type: ham_dashboard_pota_spot
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: >
          {{ trigger.event.data.activator }} at {{ trigger.event.data.reference }}
          ({{ trigger.event.data.park }}) on {{ trigger.event.data.frequency_khz }} kHz
          {{ trigger.event.data.mode }}

- alias: "Watched DX spotted"
  triggers:
    - trigger: event
      event_type: ham_dashboard_dx_spot
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: "{{ trigger.event.data.dx }} on {{ trigger.event.data.frequency_khz }} kHz {{ trigger.event.data.mode }}"

- alias: "Good satellite pass in 10 minutes"
  triggers:
    - trigger: template
      value_template: >
        {{ as_timestamp(states('sensor.ham_next_good_pass'), 0) - as_timestamp(now()) < 600
           and as_timestamp(states('sensor.ham_next_good_pass'), 0) > as_timestamp(now()) }}
  actions:
    - action: notify.mobile_app_your_phone
      data:
        message: >
          {{ state_attr('sensor.ham_next_good_pass', 'satellite') }} rises in 10 minutes,
          max {{ state_attr('sensor.ham_next_good_pass', 'max_elevation') | round }}°
```

## Data sources

- [N0NBH / HamQSL](https://www.hamqsl.com/solar.html) solar XML (cached 30 min)
- [NOAA SWPC](https://www.swpc.noaa.gov/) JSON and text products (5–60 min)
- [KC2G](https://prop.kc2g.com/) ionosonde data and MUF/foF2 maps (10 min)
- [PSKReporter](https://pskreporter.info/) (cached 5 min per callsign, as they request)
- [HearHam](https://hearham.com/) repeater directory (downloaded at most once a day)
- [QRZ.com](https://www.qrz.com/) XML callbook and [callook.info](https://callook.info/)
  FCC data (cached a day per callsign, fetched only when you look a call up)
- DX cluster via telnet (live)
- [APRS-IS](https://www.aprs2.net/) via `rotate.aprs2.net:14580`, receive-only (live)
- [POTA](https://pota.app/) activator spots (cached 1 min; polled every 2 min for alerts)
- [CelesTrak](https://celestrak.org/) amateur satellite elements (cached 12 h)
- [PSKReporter](https://pskreporter.info/) area query for band activity (one query every 5 minutes, as PSKReporter asks)
- [National Weather Service](https://www.weather.gov/documentation/services-web-api) alerts (cached 2 min) and hourly forecast (cached 30 min)

The add-on caches everything server-side, so opening the dashboard on several
devices doesn't multiply the requests to these free services.

## Notes

- The "At your QTH" rating is a rule-of-thumb estimate, not a VOACAP prediction.
  It is most useful when an ionosonde is reasonably close to you.
- The DX cluster requires a callsign to log in. Without one, the spots panel stays
  empty.
- Storm safety is an aid, not a guarantee. Disconnect antennas whenever you hear
  thunder, whatever the dashboard says. Blitzortung lightning data isn't used: its
  terms don't allow storm warnings or equipment protection.
- RepeaterBook isn't used as a data source. Its API is limited to approved apps and
  excludes nearby-repeater finders, so the dashboard only links to its pages.
