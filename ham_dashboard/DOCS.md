# Ham Radio Dashboard

A read-only propagation and space-weather dashboard for amateur radio operators.
It adds a **Ham Radio** panel to the Home Assistant sidebar.

## What it shows

- **Solar & geomagnetic conditions** – SFI, sunspot number, A and K index, X-ray flux,
  solar wind speed, Bz and estimated noise floor.
- **NOAA space weather scales** – current R (radio blackout), S (radiation) and G
  (geomagnetic) levels, yesterday's maximum and the 3-day probability forecast.
- **HF band conditions, 80 m – 6 m**
  - *HamQSL* day/night ratings by N0NBH.
  - *At your QTH now* – a local estimate that compares each band with the MUF(3000)
    measured by the nearest ionosonde (within 3000 km, last 3 hours), adjusted for
    daytime D-layer absorption on 80/60/40 m and for geomagnetic storms.
  - VHF: aurora and sporadic-E status.
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

## Configuration

| Option | Description |
| --- | --- |
| `callsign` | Your callsign. Used to log in to the DX cluster and as the default for PSKReporter. |
| `grid` | Your Maidenhead grid square (4 or 6 characters, e.g. `DM14xd`). |
| `distance_units` | `mi` or `km`. |
| `dx_cluster_enabled` | Keep a telnet connection to a DX cluster for live spots. |
| `dx_cluster_host` / `dx_cluster_port` | The cluster to use. Default: `dxc.ve7cc.net:23`. |

These are the defaults for everyone who opens the panel. Each person can also click
the callsign/grid chip at the top right and enter their own. That choice is saved
in their browser only, so several operators can share one Home Assistant.

## Data sources

- [N0NBH / HamQSL](https://www.hamqsl.com/solar.html) solar XML (cached 30 min)
- [NOAA SWPC](https://www.swpc.noaa.gov/) JSON and text products (5–60 min)
- [KC2G](https://prop.kc2g.com/) ionosonde data and MUF/foF2 maps (10 min)
- [PSKReporter](https://pskreporter.info/) (cached 5 min per callsign, as they request)
- DX cluster via telnet (live)

The add-on caches everything server-side, so opening the dashboard on several
devices doesn't multiply the requests to these free services.

## Notes

- The "At your QTH" rating is a rule-of-thumb estimate, not a VOACAP prediction.
  It is most useful when an ionosonde is reasonably close to you.
- The DX cluster requires a callsign to log in. Without one, the spots panel stays
  empty.
