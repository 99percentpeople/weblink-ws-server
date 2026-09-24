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

TLS is optional and can be enabled by setting the `TLS_CERT_FILE` and `TLS_KEY_FILE` environment variables or set in the .env file.

Optionally, a list of CA files can be set in the `TLS_CA_FILES` environment variable or .env file to enable mutual TLS.
