# IP Address Detector

Comprehensively detect your IP address from multiple network paths, quickly determine if you're using direct connection or traffic splitting.

[中文文档](./README.zh.md)

## Features

- **Multi-source Detection** — Detect exit IPs from 4 independent network paths: domestic, foreign, Google, and Cloudflare
- **Latency Display** — Show real-time response time for each detection (in milliseconds)
- **API Source Info** — Display the specific API endpoint that provided the result
- **IPv6 Support** — Support both IPv4 and IPv6 address detection
- **Geolocation** — Automatically query geographic location information for IPs
- **Detection Summary** — Quick assessment of network status (direct connection/split/blocked)
- **Privacy First** — All detection runs in your browser, no data collected

## Detection Methods

### Domestic Test

- Uses domestic IP lookup APIs (ipip.net, useragentinfo, pconline)
- Shows the IP used when accessing domestic websites

### Foreign Test

- Uses multiple international IP lookup APIs (ipify, ip.sb, httpbin, amazonaws)
- Shows the IP used when accessing overseas sites

### Google Test

- Uses Google 204 probes to test reachability from the browser
- Reuses the foreign IP result as the best-effort Google exit when the route is reachable

### Cloudflare Test

- Uses Cloudflare's /cdn-cgi/trace endpoint
- Gets Cloudflare route exit IP and country code

## Network Status

| Status | Meaning | Display |
| -------- | --------- | --------- |
| Direct | All exit IPs are the same | Same exit |
| Split | Multiple different exits detected | N exits detected |
| Partial Block | Some routes are blocked | Some routes blocked |
| Heavy Block | Google and CF both blocked | Google & CF blocked |
| Unavailable | All detections failed | All failed |

## Usage

1. Open `index.html` in your browser, or serve the folder with a simple local static server for stricter browsers
2. Page auto-detects IPs from all 4 sources
3. Click "Re-detect" button to refresh results
4. Hover or click the 📋 button on IP cards to copy

## Tech Stack

- **Language**: Vanilla JavaScript (no framework)
- **Styling**: Vanilla CSS with CSS variables
- **Browser APIs**:
  - Fetch API with abort signal
  - Clipboard API
  - Performance API (latency measurement)
- **Third-party APIs**:
  - ipip.net, useragentinfo.com, pconline.com.cn (domestic)
  - ipify.org, ip.sb, httpbin.org, amazonaws.com (foreign)
  - google.com, googleapis.com, gstatic.com (Google)
  - 1.1.1.1, cloudflare.com (Cloudflare)
  - ipinfo.io (geolocation)

## Development

Ultra-simple project structure:

- `index.html` — Page markup
- `core.js` — Pure detection helpers and summary logic
- `browser-utils.js` — Fetch, timeout, deferred, and geo lookup helpers
- `ui-components.js` — Result-card, summary, and interaction-feedback components
- `ui.js` — UI component orchestration and client-side state
- `detectors.js` — Individual network probe implementations
- `app.js` — Thin bootstrap, orchestration, and event wiring
- `core.test.js` — Minimal Node-based unit tests for pure logic
- `styles.css` — Styling (~540 lines)

### Key Timeouts

- Domestic APIs: 6 seconds
- Foreign APIs: 7 seconds
- Other requests: 8 seconds
- Button debounce: 1.2 seconds
- Toast display: 1.8 seconds

### Run Tests

```bash
node --test *.test.js
```

### Adding API Sources

Edit `DOMESTIC_APIS` or `FOREIGN_APIS` in `detectors.js`:

```javascript
const DOMESTIC_APIS = [
  {
    url: "https://your-api.com/json",
    parse: (data) => ({
      ip: data.ip,
      location: data.location,
    }),
  },
  // ...
];
```

## Privacy

- ✅ **Runs Locally** — All detection executes in your browser
- ✅ **Zero Collection** — No data is collected, stored, or transmitted
- ✅ **No Tracking** — No analytics, statistics, or ads

> External API calls follow their respective privacy policies.

## License

MIT
