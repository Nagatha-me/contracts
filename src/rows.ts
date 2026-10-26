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
} as const;

export type SyncType = (typeof SyncType)[keyof typeof SyncType];

export const SYNC_TYPES: readonly SyncType[] = [
  SyncType.User,
  SyncType.SignalRollup,
  SyncType.SignalNameRollup,
];

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
 *
 * `programs` counts programs UPLOADED that day: the sum of each document's
 * program count. The same program sent in two uploads counts twice, so it is
 * not a count of unique programs. Unique programs come later, with the
 * program token dedupe of design section 8; this column keeps its name and
 * its meaning when that lands.
 *
 * `uploads` counts program documents (`POST /signals`); `pulses` counts
 * accepted pulses (`POST /signals/pulse`). The per-kind counters add each
 * pulse's `count`: run.started to `runsStarted`, run.finished to
 * `runsFinished`, nag.shown to `nagsShown`, nag.completed to `nagsCompleted`,
 * nag.snoozed to `snoozes`, nag.skipped to `skips`, line.shared to `shares`,
 * line.laughed to `laughs`. A program document also adds its week's
 * `nagsShown`, `nagsCompleted`, `runsStarted` and `runsFinished`, as before
 * 0.2.0; it does not touch `pulses` or the four counters added in 0.2.0.
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
export function signalRollupId(day: string, region: string): string {
  return `${day}|${region}`;
}

export function signalNameRollupId(day: string, itemKind: string, name: string): string {
  return `${day}|${itemKind}|${name}`;
}
