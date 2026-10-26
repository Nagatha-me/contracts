/**
 * Row types for the sync slices. These are exactly what arrives in
 * `SYNC_DATA.data`, in `DIFF_SYNC.changes[type].upserted`, and in
 * `SOCKET_EVENT.data`. One canonical shape per type, whichever path it took.
 *
 * Every row has a string `id`; the client's slice upserts by it. Timestamps are
 * ISO 8601 strings in UTC. `day` is a calendar day in UTC, `YYYY-MM-DD`.
 */
/** The sync types, which are also the `entityKind` of their events. */
export declare const SyncType: {
    readonly User: "user";
    readonly SignalRollup: "signal_rollup";
    readonly SignalNameRollup: "signal_name_rollup";
};
export type SyncType = (typeof SyncType)[keyof typeof SyncType];
export declare const SYNC_TYPES: readonly SyncType[];
/** The signed-in person. A socket only ever receives its own user row. */
export interface UserRow {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    isSuperAdmin: boolean;
    createdAt: string;
    updatedAt: string;
}
/**
 * Upload totals for one UTC day and one region. Super admins only.
 * `id` is `${day}|${region}`.
 */
export interface SignalRollupRow {
    id: string;
    day: string;
    region: string;
    uploads: number;
    programs: number;
    nagsShown: number;
    nagsCompleted: number;
    runsStarted: number;
    runsFinished: number;
    updatedAt: string;
}
/**
 * How many uploaded items carried this name and kind on one UTC day. Super
 * admins only. `id` is `${day}|${itemKind}|${name}`: the name goes last so the
 * id splits unambiguously at the first two bars even when a name holds one.
 */
export interface SignalNameRollupRow {
    id: string;
    day: string;
    name: string;
    itemKind: string;
    count: number;
    updatedAt: string;
}
/** Row type per sync type, for typed routing on the client. */
export interface SyncRowByType {
    user: UserRow;
    signal_rollup: SignalRollupRow;
    signal_name_rollup: SignalNameRollupRow;
}
/** Build the rollup ids, so server and client never disagree on them. */
export declare function signalRollupId(day: string, region: string): string;
export declare function signalNameRollupId(day: string, itemKind: string, name: string): string;
//# sourceMappingURL=rows.d.ts.map