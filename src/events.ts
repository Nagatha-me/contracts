/**
 * Socket.IO wire contract: event names and payloads.
 *
 * The flow (see `/workspace/ai/ctw/docs/engineering/portal-sync-pattern.md`):
 *
 *  1. The client connects with handshake auth `{ token, cursor? }`.
 *  2. No cursor: the server streams `SYNC_DATA` frames, then `SYNC_COMPLETE`.
 *     A cursor: the server answers `DIFF_SYNC` with every change since it, or
 *     `SYNC_RESET` followed by a full `SYNC_DATA` stream when it cannot.
 *  3. From then on every committed change arrives as `SOCKET_EVENT`, in the
 *     same tick it committed. Components read the store; they never refetch.
 *  4. Calls go out as `RPC` with an ack (`rpc.ts`).
 */

import type { SyncRowByType, SyncType } from "./rows.js";

export const SocketEventName = {
  /** Server to client: one frame of rows for one sync type. */
  SyncData: "SYNC_DATA",
  /** Server to client: the full sync has been sent; carries the cursor to keep. */
  SyncComplete: "SYNC_COMPLETE",
  /** Server to client: everything that changed since the handshake cursor. */
  DiffSync: "DIFF_SYNC",
  /** Server to client: drop the store; a fresh full `SYNC_DATA` stream follows. */
  SyncReset: "SYNC_RESET",
  /** Server to client: one committed change (the live path). */
  SocketEvent: "SOCKET_EVENT",
  /** Client to server: an RPC call with an ack callback. */
  Rpc: "RPC",
} as const;

export type SocketEventName = (typeof SocketEventName)[keyof typeof SocketEventName];

/**
 * Handshake auth, passed as `io(url, { auth: { token, cursor } })`.
 * `token` comes from `GET /auth/socket-token`. `cursor` is the last
 * `SYNC_COMPLETE.cursor`, `DIFF_SYNC.toCursor` or `SOCKET_EVENT.cursor` the
 * client applied; omit it for a cold start.
 */
export interface SocketHandshakeAuth {
  token: string;
  cursor?: string;
}

/**
 * `SYNC_DATA`: rows for one type. Frames for a type arrive in order and are
 * coalesced (up to a few hundred rows each). In a frame with rows, `total`
 * equals `data.length`. Every type then ends with one frame whose `data` is
 * empty: that frame terminates the type, and its `total` is the number of rows
 * sent for the type in this sync. A type with no rows sends only the terminator.
 */
export interface SyncDataFrame<T extends SyncType = SyncType> {
  type: T;
  data: SyncRowByType[T][];
  total: number;
}

/** `SYNC_COMPLETE`: keep `cursor` and present it on the next handshake. */
export interface SyncCompletePayload {
  cursor: string;
  /** Server time spent producing the sync, for the client's own timing. */
  serverElapsedMs: number;
  /** Rows sent per type, counted in the stream. */
  counts: Partial<Record<SyncType, number>>;
}

/** One type's share of a `DIFF_SYNC`. `removed` holds ids. */
export interface DiffSyncTypeChanges<T extends SyncType = SyncType> {
  upserted: SyncRowByType[T][];
  removed: string[];
}

/**
 * `DIFF_SYNC`: merge into the store, then keep `toCursor`. Each entity appears
 * at most once (its latest state). Types with no changes are omitted.
 */
export interface DiffSyncPayload {
  fromCursor: string;
  toCursor: string;
  changes: { [K in SyncType]?: DiffSyncTypeChanges<K> };
}

export const SyncResetReason = {
  /** The cursor is older than the retained event window (30 days). */
  CursorTooOld: "cursor_too_old",
  /** The cursor is not one this server issued. */
  CursorInvalid: "cursor_invalid",
  /** What this connection may see changed (for example, it became a super admin). */
  ScopeChanged: "scope_changed",
} as const;

export type SyncResetReason = (typeof SyncResetReason)[keyof typeof SyncResetReason];

/** `SYNC_RESET`: discard local state; a full `SYNC_DATA` stream follows on this socket. */
export interface SyncResetPayload {
  reason: SyncResetReason;
}

export type SocketEventVerb = "CREATED" | "UPDATED" | "DELETED" | "OTHER";

/**
 * `SOCKET_EVENT`: one committed change. `data` is the FULL canonical row for
 * `entityKind` (the same shape as `SYNC_DATA`), or `{ id }` when `verb` is
 * `DELETED`. Upsert by `entityId`; a duplicate arrival is a harmless no-op.
 */
export interface SocketEventEnvelope<T extends SyncType = SyncType> {
  /** The event type, `"<entityKind>.<verb lower case>"`, for example `signal_rollup.updated`. */
  event: string;
  entityKind: T;
  entityId: string;
  verb: SocketEventVerb;
  cursor: string;
  occurredAt: string;
  data: SyncRowByType[T] | { id: string };
}

/** The event types the server writes today. */
export const EventType = {
  UserUpdated: "user.updated",
  SignalRollupUpdated: "signal_rollup.updated",
  SignalNameRollupUpdated: "signal_name_rollup.updated",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** Derive the verb from an event type's suffix. */
export function verbOf(eventType: string): SocketEventVerb {
  const suffix = eventType.slice(eventType.lastIndexOf(".") + 1).toLowerCase();
  if (suffix === "created") return "CREATED";
  if (suffix === "updated") return "UPDATED";
  if (suffix === "deleted") return "DELETED";
  return "OTHER";
}
