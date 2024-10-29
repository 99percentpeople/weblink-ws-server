import pino from "pino";
import {
  LOG_LEVEL,
  PORT,
  HEARTBEAT_INTERVAL,
  PONG_TIMEOUT,
  DISCONNECT_TIMEOUT,
  REDIS_URL,
  ALLOWED_ORIGINS,
  HOSTNAME,
  TLS_CA_FILES,
  TLS_KEY_FILE,
  TLS_CERT_FILE,
  TLS_ENABLED,
} from "./var";
import os from "os";
import Redis from "ioredis";

import type { ServerWebSocket } from "bun";

import type { ClientSignal, RawSignal, Room, ServerWebSocketData, TransferClient } from "./types";

const logger = pino({
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { pid: process.pid },
  transport: Bun.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
});

// optional redis
const redisPub: Redis | null = REDIS_URL
  ? new Redis(REDIS_URL, {
      retryStrategy(times) {
        if (times > 5) {
          logger.error("Redis connection failed");
          return null;
        }
        return times * 500 + 500;
      },
    })
  : null;

if (redisPub) {
  logger.info({ redisUrl: REDIS_URL }, "Redis is enabled");
} else {
  logger.warn("Redis is disabled");
}

const redisSub: Redis | null = redisPub?.duplicate() ?? null;

redisPub?.on("error", (err) => {
  logger.error({ err }, "Error publishing to Redis channel");
});

redisSub?.on("error", (err) => {
  logger.error({ err }, "Error subscribing to Redis channel");
});

const rooms: Map<string, Room> = new Map();

const subscribedChannels: Set<string> = new Set();

function subscribeToRedis(roomId: string) {
  if (!redisSub) return;
  // if already subscribed, do nothing
  if (subscribedChannels.has(roomId)) return;
  redisSub.subscribe(`room:${roomId}`, (err, count) => {
    if (err) {
      logger.error({ err }, "Error subscribing to Redis channel");
    } else {
      subscribedChannels.add(roomId);
      logger.info(`Subscribed to ${count} channels`);
    }
  });
}

function unsubscribeFromRedis(roomId: string) {
  if (!redisSub) return;
  // if not subscribed, do nothing
  if (!subscribedChannels.has(roomId)) return;
  redisSub.unsubscribe(`room:${roomId}`);
  subscribedChannels.delete(roomId);
}

function publishToRedis(roomId: string, signal: RawSignal) {
  if (!redisPub) return;
  // if redisSub not subscribe this channel, do nothing
  if (!subscribedChannels.has(roomId)) return;
  redisPub.publish(`room:${roomId}`, JSON.stringify(signal));
}

redisSub?.on("message", (channel, message) => {
  const signal = JSON.parse(message) as RawSignal;
  logger.info(`Received message on channel ${channel}: ${signal}`);
  const roomId = channel.split(":")[1]; // room ID
  const room = rooms.get(roomId);
  if (!room) {
    logger.warn({ roomId }, "can not handle redis message, room not found");
    return;
  }

  switch (signal.type) {
    case "join":
      handleClientJoin(room, signal.data as TransferClient);
      break;
    case "message":
      handleClientMessage(room, signal.data as ClientSignal);
      break;
    case "leave":
      handleClientLeave(room, signal.data as TransferClient);
      break;
    default:
      logger.warn({ signal }, "redis unknown signal type");
      break;
  }
});

const server = Bun.serve<ServerWebSocketData>({
  port: PORT,
  hostname: HOSTNAME,
  tls: TLS_ENABLED
    ? {
        cert: Bun.file(TLS_CERT_FILE!),
        key: Bun.file(TLS_KEY_FILE!),
        ca: TLS_CA_FILES?.map((ca) => Bun.file(ca)) ?? [],
      }
    : undefined,
  fetch(req, server) {
    const url = new URL(req.url);
    const roomId = url.searchParams.get("room") || "";
    const passwordHash = url.searchParams.get("pwd") || "";

    // get request origin
    const origin = req.headers.get("Origin") || "";

    if (url.pathname.startsWith("/healthcheck")) {
      // create new headers
      const headers = new Headers({
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });

      // if origin is allowed, set CORS headers
      if (ALLOWED_ORIGINS.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
      }

      return new Response("OK", {
        status: 200,
        statusText: "OK",
        headers,
      });
    }

    if (
      server.upgrade(req, {
        data: { roomId, passwordHash, clientId: null },
      })
    ) {
      return;
    }

    return new Response(undefined, { status: 400, statusText: "Bad Request" });
  },
  websocket: {
    open(ws) {
      handleWSOpen(ws);
    },
    message(ws, message) {
      handleWSMessage(ws, message);
    },
    close(ws) {
      handleWSClose(ws);
    },
  },
});

function handleWSOpen(ws: ServerWebSocket<ServerWebSocketData>) {
  const { roomId, passwordHash } = ws.data;
  logger.info({ remoteAddress: ws.remoteAddress, roomId }, "New connection");

  let room: Room | undefined = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      clients: new Map(),
      passwordHash: passwordHash || null,
    };
    rooms.set(roomId, room);
    subscribeToRedis(room.id);
    logger.info({ roomId }, "Room created");
  }

  ws.send(
    JSON.stringify({
      type: "connected",
      data: room.passwordHash,
    })
  );
}

function handleWSMessage(ws: ServerWebSocket<ServerWebSocketData>, message: string | Buffer) {
  try {
    const signal: RawSignal = JSON.parse(message.toString());
    const room: Room | undefined = rooms.get(ws.data.roomId);

    if (!room) {
      logger.warn({ roomId: ws.data.roomId }, "Room not found");
      return;
    }

    if (signal.type === "pong") {
      const clientData = room.clients.get(ws.data.clientId || "");
      if (clientData) {
        clientData.lastPongTime = Date.now();
      }
      return;
    }

    switch (signal.type) {
      case "join":
        handleClientJoin(room, signal.data as TransferClient, ws);
        break;
      case "message":
        handleClientMessage(room, signal.data as ClientSignal, ws);
        break;
      case "leave":
        handleClientLeave(room, signal.data as TransferClient, ws);
        break;
      default:
        logger.warn({ signal }, "Unknown signal type");
        break;
    }
  } catch (error) {
    logger.error({ error }, "Error processing message");
  }
}

function handleWSClose(ws: ServerWebSocket<ServerWebSocketData>) {
  const room: Room | undefined = rooms.get(ws.data.roomId);
  if (!room) {
    logger.warn({ roomId: ws.data.roomId }, "Room not found");
    return;
  }

  const clientData = room.clients.get(ws.data.clientId || "");
  if (!clientData) {
    logger.warn({ clientId: ws.data.clientId }, "Client not found");
    return;
  }

  // set disconnect timeout
  if (!clientData.disconnectTimeout) {
    clientData.disconnectTimeout = setTimeout(() => {
      handleClientLeave(room, clientData.client, clientData.session);
    }, DISCONNECT_TIMEOUT);
  }
}

function handleClientJoin(
  room: Room,
  client: TransferClient,
  ws?: ServerWebSocket<ServerWebSocketData>
) {
  const existingClient = room.clients.get(client.clientId);

  // if local connection, set clientId and add to local room
  if (ws) {
    ws.data.clientId = client.clientId;

    if (existingClient && client.resume) {
      // if client is resuming, reconnect
      if (existingClient.disconnectTimeout) {
        clearTimeout(existingClient.disconnectTimeout);
        existingClient.disconnectTimeout = null;
      }
      existingClient.session = ws;
      existingClient.lastPongTime = Date.now();
      logger.info({ clientId: client.clientId, name: client.name }, "Client reconnected");

      // send cached messages
      existingClient.messageCache.forEach((message) => {
        ws.send(JSON.stringify(message));
      });
      existingClient.messageCache = [];

      return;
    }
    // if client is not resuming
    room.clients.delete(client.clientId);
    const leaveMessage: RawSignal = {
      type: "leave",
      data: client,
    };
    room.clients.forEach((clientData) => {
      if (clientData.session === ws) return;
      if (clientData.session.readyState === WebSocket.OPEN) {
        clientData.session.send(JSON.stringify(leaveMessage));
        logger.info(
          {
            clientId: clientData.client.clientId,
            name: clientData.client.name,
          },
          "send leave message to client"
        );
      } else {
        clientData.messageCache.push(leaveMessage);
      }
    });
    publishToRedis(room.id, leaveMessage);
  }

  // send join message to new client
  room.clients.forEach(({ client }) => {
    const joinMessage: RawSignal = {
      type: "join",
      data: client,
    };
    if (ws) {
      // if local connection, send join message to client
      ws.send(JSON.stringify(joinMessage));
    } else {
      // if remote connection, publish join message to redis
      publishToRedis(room.id, joinMessage);
    }
  });

  const joinMessage: RawSignal = {
    type: "join",
    data: client,
  };
  // send join message to other clients
  room.clients.forEach(({ client, session, messageCache }) => {
    if (session === ws) return;
    if (session.readyState === WebSocket.OPEN) {
      session.send(JSON.stringify(joinMessage));
      logger.info({ clientId: client.clientId, name: client.name }, "send join message to client");
    } else {
      messageCache.push(joinMessage);
    }
  });

  if (ws) {
    room.clients.set(client.clientId, {
      client,
      session: ws,
      lastPongTime: Date.now(),
      disconnectTimeout: null,
      messageCache: [],
    });

    publishToRedis(room.id, joinMessage);
  }
}

function handleClientLeave(
  room: Room,
  client: TransferClient,
  ws?: ServerWebSocket<ServerWebSocketData>
) {
  if (ws) {
    const clientData = room.clients.get(client.clientId);
    if (!clientData) {
      return;
    }

    // if exist disconnect timeout, cancel it
    if (clientData.disconnectTimeout) {
      clearTimeout(clientData.disconnectTimeout);
      clientData.disconnectTimeout = null;
    }

    // remove client from room
    room.clients.delete(client.clientId);
  }
  logger.info({ clientId: client.clientId, name: client.name }, "Client left");

  const leaveMessage: RawSignal = {
    type: "leave",
    data: client,
  };
  room.clients.forEach((targetClientData, targetClientId) => {
    if (targetClientData.session.readyState === WebSocket.OPEN) {
      targetClientData.session.send(JSON.stringify(leaveMessage));
      logger.info(
        { targetClientId, targetName: targetClientData.client.name },
        "Send leave message"
      );
    } else {
      targetClientData.messageCache.push(leaveMessage);
    }
  });

  // message from local client, publish to redis
  if (ws) {
    publishToRedis(room.id, leaveMessage);
    ws.close();
  }

  // if room is empty, delete room
  if (room.clients.size === 0) {
    rooms.delete(room.id);
    unsubscribeFromRedis(room.id);
    logger.info({ roomId: room.id }, "Room deleted");
  }
}

function handleClientMessage(
  room: Room,
  data: ClientSignal,
  ws?: ServerWebSocket<ServerWebSocketData>
) {
  const targetClientData = room?.clients.get(data.targetClientId);
  const clientData = room?.clients.get(data.clientId || "");

  if (targetClientData) {
    if (targetClientData.session.readyState === WebSocket.OPEN) {
      targetClientData.session.send(
        JSON.stringify({
          type: "message",
          data: data,
        })
      );
      logger.debug(
        {
          clientId: data.clientId,
          clientName: clientData?.client.name,
          targetClientId: data.targetClientId,
          targetClientName: targetClientData.client.name,
        },
        "send message to client"
      );
    }
  } else {
    // local client message, publish to redis
    if (ws) {
      publishToRedis(room.id, data);

      logger.debug(
        {
          clientId: data.clientId,
          clientName: clientData?.client.name,
          targetClientId: data.targetClientId,
        },
        "publish message to redis"
      );
    }
  }
}

function startHeartbeat() {
  setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, roomId) => {
      room.clients.forEach((clientData, clientId) => {
        if (clientData.session.readyState === WebSocket.OPEN) {
          if (now - clientData.lastPongTime > PONG_TIMEOUT) {
            logger.warn({ clientId, roomId }, "Client timed out, closing connection");
            clientData.session.close();
          } else {
            clientData.session.send(JSON.stringify({ type: "ping" }));
          }
        }
      });
    });
  }, HEARTBEAT_INTERVAL);
}

const addresses: string[] = [HOSTNAME];

// get all ip addresses
if (HOSTNAME === "0.0.0.0") {
  const interfaces = os.networkInterfaces();
  const ips = Object.values(interfaces).flatMap((iface) => iface?.map((iface) => iface.address));
  addresses.push(...(ips.filter((ip) => ip !== undefined) as string[]));
}

logger.info({ port: server.port, hostname: HOSTNAME, addresses }, "WebSocket server started");

startHeartbeat();
process.on("SIGINT", () => {
  logger.info("Shutting down server...");
  server.stop();
  redisPub?.quit();
  redisSub?.quit();
  logger.info("Server closed");
  process.exit(0);
});
