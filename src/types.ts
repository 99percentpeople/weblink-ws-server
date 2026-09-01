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
  sessionId: SessionID;
  clientId: ClientID;
  targetClientId: ClientID;
}

export type ServerWebSocketData = {
  roomId: string;
  passwordHash: string;
  clientId: ClientID | null;
};

export interface ClientData {
  client: TransferClient;
  session: ServerWebSocket<ServerWebSocketData>;
  lastPongTime: number;
  disconnectTimeout: Timer | null;
  messageCache: RawSignal[];
}

export interface Room {
  id: string;
  clients: Map<ClientID, ClientData>;
  passwordHash: string | null;
}
