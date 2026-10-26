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