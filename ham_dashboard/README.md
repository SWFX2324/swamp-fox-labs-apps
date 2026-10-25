# Ham Radio Dashboard

![logo](logo.png)

A read-only propagation and space-weather dashboard for amateur radio operators,
in its own Home Assistant sidebar panel. It works on phones and desktops, in light
and dark mode.

- HF band conditions, 80 m – 6 m: N0NBH/HamQSL ratings plus a local estimate from
  the nearest ionosonde, and measured activity heard nearby
  from PSKReporter
- Station storm safety from NWS alerts and an optional lightning sensor, with a
  Home Assistant sensor that can disconnect your antennas
- NOAA R/S/G scales, SFI, sunspot number, K/A index, X-ray flux, solar wind and Bz
- Gray line map with sunrise, sunset and gray line times for your grid, plus the
  KC2G MUF and foF2 maps
- Kp chart with the 3-day forecast, and the solar cycle chart
- Live DX cluster spots, and PSKReporter "who's hearing me"
- NOAA alerts, watches and warnings
- **Repeaters** tab: nearby repeaters on a map and in a filterable list, from HearHam
- **APRS** tab: live stations, tracks and local weather stations around you, from
  APRS-IS (receive-only)
- **POTA** tab: Parks on the Air activators on a world map and in a filterable list
- **Satellites** tab: pass predictions with a sky plot and Doppler-corrected
  frequencies for ISS, SO-50, RS-44 and more
- **Home Assistant sensors and alerts**: band conditions, space weather, satellite
  passes and POTA activity as entities, plus events for watched DX and nearby POTA
  activations
- **Callsign lookup** tab: QRZ.com (with your own login) or free FCC data for US
  calls, with beam heading and great-circle path from your QTH

After installing, set your `callsign` and `grid` on the **Configuration** tab. Add
your QRZ username and password there too if you want worldwide callsign lookups.
See the **Documentation** tab for details.

Data from N0NBH/HamQSL, NOAA SWPC, KC2G, PSKReporter, HearHam, APRS-IS, POTA,
CelesTrak, the National Weather Service, QRZ.com, callook.info and the VE7CC DX cluster. The world outline comes
from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public
domain).

Satellite orbits are computed with [satellite.js](https://github.com/shashwatak/satellite-js)
5.0.0 (MIT License, included in `app/lib`).
