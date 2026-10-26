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
 * Totals for one UTC day and one region. Super admins only.
 * `id` is `${day}|${region}`.
 *
 * `programs` counts programs UPLOADED that day: the sum of each document's
 * program count. The same program sent in two uploads counts twice, so it is
 * not a count of unique programs; `newProgramsWeek` and `newProgramsMonth`
 * are the unique counts.
 *
 * `uploads` counts program documents (`POST /signals`); `pulses` counts
 * accepted pulses (`POST /signals/pulse`); `devices` counts day keys attested
 * (`POST /signals/key`), one per phone per day, so it is the day's active
 * devices in the region (0.3.0).
 *
 * Pulses own the live counters (0.3.0). Each pulse adds its `count`:
 * run.started to `runsStarted`, run.finished to `runsFinished`, nag.shown to
 * `nagsShown`, nag.completed to `nagsCompleted`, nag.snoozed to `snoozes`,
 * nag.skipped to `skips`, line.shared to `shares`, line.laughed to `laughs`.
 * A program document no longer adds its week's counts to any of these; it
 * adds `uploads` and `programs` only, and its counts stay in the stored
 * document.
 *
 * `newProgramsWeek` and `newProgramsMonth` (0.3.0) count first sightings: a
 * program's week token (or month token), from a pulse or a document, seen for
 * the first time in its UTC ISO week (or UTC month), counted on the day and
 * in the region of that first sighting. Summed over the days of one ISO week,
 * `newProgramsWeek` is the number of programs active that week; summed over
 * one month, `newProgramsMonth` is the number active that month. A sum over
 * any other window means nothing.
 */
export interface SignalRollupRow {
    id: string;
    day: string;
    region: string;
    uploads: number;
    programs: number;
    /** Accepted pulses (0.2.0). */
    pulses: number;
    nagsShown: number;
    nagsCompleted: number;
    runsStarted: number;
    runsFinished: number;
    /** From pulses only (0.2.0). */
    snoozes: number;
    /** From pulses only (0.2.0). */
    skips: number;
    /** From pulses only (0.2.0). */
    shares: number;
    /** From pulses only (0.2.0). */
    laughs: number;
    /** Day keys attested: active devices (0.3.0). */
    devices: number;
    /** Week tokens first seen in their ISO week (0.3.0). */
    newProgramsWeek: number;
    /** Month tokens first seen in their month (0.3.0). */
    newProgramsMonth: number;
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