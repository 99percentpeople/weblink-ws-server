import type { ServerWebSocket } from "bun";

export type SessionID = string;
export type ClientID = string;

export interface TransferClient {
  clientId: ClientID;
  createdAt: number;
  rtcProfileVersion?: number;
  resume?: boolean;
}

export interface RawSignal {
  type: string;
  data: any;
}

export interface ClientSignal extends RawSignal {
  sessionId?: SessionID;
  clientId: ClientID;
  targetClientId: ClientID;
}

export type ServerWebSocketData = {
  roomId: string;
  clientIp: string;
  handshakePasswordHash: string | null;
  clientId: ClientID | null;
  connectionId: string;
  identityKey?: string;
};

export interface ClientData {
  client: TransferClient;
  session: ServerWebSocket<ServerWebSocketData>;
  connectionId: string;
  identityKey?: string;
  lastPongTime: number;
  disconnectTimeout: Timer | null;
  messageCache: RawSignal[];
}

export interface Room {
  id: string;
  clients: Map<ClientID, ClientData>;
  // Undefined until the first admitted member commits the room verifier.
  passwordHash?: string | null;
  joinTail?: Promise<void>;
}
