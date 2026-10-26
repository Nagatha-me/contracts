/**
 * Row types for the sync slices. These are exactly what arrives in
 * `SYNC_DATA.data`, in `DIFF_SYNC.changes[type].upserted`, and in
 * `SOCKET_EVENT.data`. One canonical shape per type, whichever path it took.
 *
 * Every row has a string `id`; the client's slice upserts by it. Timestamps are
 * ISO 8601 strings in UTC. `day` is a calendar day in UTC, `YYYY-MM-DD`.
 */
/** The sync types, which are also the `entityKind` of their events. */
export const SyncType = {
    User: "user",
    SignalRollup: "signal_rollup",
    SignalNameRollup: "signal_name_rollup",
};
export const SYNC_TYPES = [
    SyncType.User,
    SyncType.SignalRollup,
    SyncType.SignalNameRollup,
];
/** Build the rollup ids, so server and client never disagree on them. */
export function signalRollupId(day, region) {
    return `${day}|${region}`;
}
export function signalNameRollupId(day, itemKind, name) {
    return `${day}|${itemKind}|${name}`;
}
//# sourceMappingURL=rows.js.map