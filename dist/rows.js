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
    /** 0.4.0: devices and pulses per UTC hour and time zone, the last 48 hours. */
    SignalHourRollup: "signal_hour_rollup",
    /** 0.4.0: rolling 7 and 30 day active phones per region and per time zone. */
    SignalActives: "signal_actives",
};
export const SYNC_TYPES = [
    SyncType.User,
    SyncType.SignalRollup,
    SyncType.SignalNameRollup,
    SyncType.SignalHourRollup,
    SyncType.SignalActives,
];
/** Hours of `signal_hour_rollup` a full sync sends: the current hour and the 47 before it. */
export const SIGNAL_HOUR_ROLLUP_SYNC_HOURS = 48;
/** Build the rollup ids, so server and client never disagree on them. */
export function signalRollupId(day, region) {
    return `${day}|${region}`;
}
export function signalNameRollupId(day, itemKind, name) {
    return `${day}|${itemKind}|${name}`;
}
/** `hour` is the ISO start of the UTC hour (`2026-10-26T10:00:00.000Z`). */
export function signalHourRollupId(hour, timeZone) {
    return `${hour}|${timeZone}`;
}
export function signalActivesId(scope, key) {
    return `${scope}|${key}`;
}
//# sourceMappingURL=rows.js.map