/**
 * Socket.IO wire contract: event names and payloads.
 *
 * The flow (see `/workspace/ai/ctw/docs/engineering/portal-sync-pattern.md`):
 *
 *  1. The client connects with handshake auth `{ token, cursor?, scope? }`.
 *  2. No cursor: the server streams `SYNC_DATA` frames, then `SYNC_COMPLETE`.
 *     A cursor: the server answers `DIFF_SYNC` with every change since it, or
 *     `SYNC_RESET` followed by a full `SYNC_DATA` stream when it cannot.
 *  3. Catch-up `SOCKET_EVENT`s may follow the sync; from then on every
 *     committed change arrives as `SOCKET_EVENT`, in the same tick it
 *     committed. Components read the store; they never refetch.
 *  4. Calls go out as `RPC` with an ack (`rpc.ts`).
 *
 * The per-entity cursor rule (the client MUST follow it):
 *  - Keep, per entity (`entityKind` plus id), the highest cursor applied to it.
 *  - Ignore any `SOCKET_EVENT` or `DIFF_SYNC` upserted row whose cursor is
 *    lower than or equal to the cursor already applied to that entity.
 *  - A full sync (`SYNC_DATA` rows) is authoritative and carries no per-row
 *    cursor: on `SYNC_RESET` or a fresh full sync, clear the per-entity
 *    cursors with the store, and accept the next envelope for each entity.
 *  - Do not compare an envelope with the global `SYNC_COMPLETE.cursor`.
 *    Events on different rows can commit out of cursor order, so an envelope
 *    with a cursor below the global one can still be new. For one row, lock
 *    order makes cursor order equal state order, which is what the per-entity
 *    rule relies on.
 *  - Keep the highest cursor seen overall (from `SYNC_COMPLETE`,
 *    `DIFF_SYNC.toCursor` or any envelope) to present on the next handshake.
 */
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
};
/**
 * What a connection may see. `admin` is a super admin (the user row plus the
 * signal rollups); `user` is anyone else (their own user row only).
 */
export const SyncScope = {
    Admin: "admin",
    User: "user",
};
export const SyncResetReason = {
    /** The cursor is older than the retained event window (30 days). */
    CursorTooOld: "cursor_too_old",
    /** The cursor is not one this server issued. */
    CursorInvalid: "cursor_invalid",
    /** What this connection may see changed (for example, it became a super admin). */
    ScopeChanged: "scope_changed",
};
/** The event types the server writes today. */
export const EventType = {
    UserUpdated: "user.updated",
    SignalRollupUpdated: "signal_rollup.updated",
    SignalNameRollupUpdated: "signal_name_rollup.updated",
    /** 0.4.0 */
    SignalHourRollupUpdated: "signal_hour_rollup.updated",
    /** 0.4.0 */
    SignalActivesUpdated: "signal_actives.updated",
    /** 0.5.0: the nightly job wrote this series row. */
    ProgramSeriesUpdated: "program_series.updated",
};
/** Derive the verb from an event type's suffix. */
export function verbOf(eventType) {
    const suffix = eventType.slice(eventType.lastIndexOf(".") + 1).toLowerCase();
    if (suffix === "created")
        return "CREATED";
    if (suffix === "updated")
        return "UPDATED";
    if (suffix === "deleted")
        return "DELETED";
    return "OTHER";
}
//# sourceMappingURL=events.js.map