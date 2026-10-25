# Swamp Fox Labs Apps

Home Assistant apps (add-ons) by Swamp Fox Labs, KR4FCD.

## Add this repository

1. In Home Assistant go to **Settings → Apps**, then open the app store.
2. Open the **⋮** menu → **Repositories**, and add:

   ```
   https://github.com/SWFX2324/swamp-fox-labs-apps
   ```

3. The apps below appear under **Swamp Fox Labs Apps**.

Requires Home Assistant OS or a Supervised install (amd64 or aarch64).

## Apps

| | App | Description |
| --- | --- | --- |
| <img src="ham_dashboard/icon.png" width="40"> | [Ham Radio Dashboard](ham_dashboard) | Band conditions (80–6 m), NOAA R/S/G scales, SFI, sunspots, K/A index, gray line and MUF maps, DX cluster spots, PSKReporter and NOAA alerts, plus nearby repeaters and QRZ/FCC callsign lookup. |

## Developing

Each app lives in its own folder with a `config.yaml`. The Ham Radio Dashboard backend
is one Node.js file with no dependencies. To run it outside Home Assistant:

```bash
CALLSIGN=N0CALL GRID=DM14xd PORT=8099 node ham_dashboard/app/server.js
```

Then open http://localhost:8099.

## License

[MIT](LICENSE) © 2026 KR4FCD. The license covers the code in this repository. Data
shown by the apps is still subject to each source's own terms.
