# Weblink WS Server

## Introduction

This is a WebSocket signaling server for the Weblink chat application. It utilizes the Bun runtime for high-performance server-side JavaScript execution. This server facilitates the exchange of signaling data required to establish peer-to-peer connections between clients.

Redis URLs can be set to enable a distributed architecture that prioritizes locally and collaborates across instances.

### Join Acknowledgment

After installing or resuming room membership, the server emits a versioned
`joined` message before existing presence or cached signaling is replayed. Its
`resumed` flag tells the client whether the retained session was recovered.
Legacy clients safely ignore this additional signal.

### Peer Availability

After acknowledging a retained client's socket resume and replaying cached
signals, the server sends `peer-online` to the other online members. Its payload
is `{ clientId, connectionId }`, with a server-assigned socket ID. It uses the
shared signaling version reported by `joined`; this compatible addition does not
introduce or bump a version.
This permits one event-driven P2P recovery attempt without a peer retry loop;
it reports signaling availability, not ICE connectivity. The event is also
forwarded through Redis, but is never cached for offline members. Repeated joins
on the same socket do not send duplicate availability notifications. Deploy the
server support before the new frontend; old clients ignore this additive event.

### Profile Privacy

Signaling presence contains only room/connection metadata such as `clientId`, `createdAt`, the RTC profile protocol version, and the reconnect flag. The server discards incoming `name` and `avatar` fields before storing, broadcasting, or publishing presence to Redis. All display names and avatars are exchanged directly between peers over WebRTC.

### TLS Setup

TLS is optional and can be enabled with the `TLS_CERT_FILE` and `TLS_KEY_FILE` environment variables. For local development, copy `.env.example` to ignored `.env.local` and adjust it as needed.

Optionally, set `TLS_CA_FILES` to a comma-separated list of CA files to enable mutual TLS.

## Cloudflare TURN credentials

`POST /turn-credentials` exchanges backend-owned Cloudflare TURN configuration
for short-lived browser credentials. This is a public endpoint: it needs no
WebSocket upgrade, room, authentication, or rate limiter. The service does not
relay files or media; Cloudflare TURN carries relayed traffic.

Set `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` using the existing key values.
The exchange uses Cloudflare's `credentials/generate-ice-servers` API and a fixed
24-hour TTL. The JSON response is `{ iceServers, expiresAt }`, with `expiresAt`
in Unix milliseconds. Credentials are not cached or stored by this backend.
All responses have `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`.
`OPTIONS` returns 204, unsupported methods 405, unconfigured service 503,
provider failure 502, and a 10-second upstream timeout 504. Only normalized
WebRTC fields are returned; provider error details and long-term keys are not.

The frontend discovers this endpoint from the root of its WebSocket origin,
caches temporary credentials in memory, and refreshes on demand before
connection/SDP negotiation when expiry is near. A reverse proxy must forward
`/turn-credentials` as well as the WebSocket route. An unconfigured backend
continues serving signaling normally; clients can still use custom STUN/TURN.

Remove old `|cloudflare` values from frontend `VITE_TURN_SERVERS`/`PAGES_BUILD_ENV`
after configuring this endpoint. No automatic key rotation is performed.

Reference: [Cloudflare credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

Use process/container environment variables or copy `.env.example` to an ignored `.env.local`:

```dotenv
TURN_KEY_ID=<existing TURN key ID>
TURN_KEY_API_TOKEN=<existing TURN key API token>
```

Do not put these values in `.env.example` or the Docker image.
