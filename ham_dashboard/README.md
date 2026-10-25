# Ham Radio Dashboard

![logo](logo.png)

A read-only propagation and space-weather dashboard for amateur radio operators,
in its own Home Assistant sidebar panel. It works on phones and desktops, in light
and dark mode.

- HF band conditions, 80 m – 6 m: N0NBH/HamQSL ratings plus a local estimate from
  the nearest ionosonde
- NOAA R/S/G scales, SFI, sunspot number, K/A index, X-ray flux, solar wind and Bz
- Gray line map with sunrise, sunset and gray line times for your grid, plus the
  KC2G MUF and foF2 maps
- Kp chart with the 3-day forecast, and the solar cycle chart
- Live DX cluster spots, and PSKReporter "who's hearing me"
- NOAA alerts, watches and warnings
- **Repeaters** tab: nearby repeaters on a map and in a filterable list, from HearHam
- **Callsign lookup** tab: QRZ.com (with your own login) or free FCC data for US
  calls, with beam heading and great-circle path from your QTH

After installing, set your `callsign` and `grid` on the **Configuration** tab. Add
your QRZ username and password there too if you want worldwide callsign lookups.
See the **Documentation** tab for details.

Data from N0NBH/HamQSL, NOAA SWPC, KC2G, PSKReporter, HearHam, QRZ.com, callook.info
and the VE7CC DX cluster. The world
outline comes from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth,
public domain).
