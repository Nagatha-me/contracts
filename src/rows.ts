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
} as const;

export type SyncType = (typeof SyncType)[keyof typeof SyncType];

export const SYNC_TYPES: readonly SyncType[] = [
  SyncType.User,
  SyncType.SignalRollup,
  SyncType.SignalNameRollup,
  SyncType.SignalHourRollup,
  SyncType.SignalActives,
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

/** Hours of `signal_hour_rollup` a full sync sends: the current hour and the 47 before it. */
export const SIGNAL_HOUR_ROLLUP_SYNC_HOURS = 48;

/**
 * Day keys and pulses for one UTC hour and one IANA time zone (0.4.0). Super
 * admins only. `id` is `${hour}|${timeZone}` (`signalHourRollupId`).
 *
 * `hour` is the start of the UTC hour exactly as `Date.prototype.toISOString`
 * writes it, for example `2026-10-26T10:00:00.000Z`. `devices` counts day keys
 * attested in that hour from that zone: a phone is counted in the hour of its
 * first foreground of the UTC day, once a day. `pulses` counts accepted
 * pulses. `region` is the zone's region: the region of the first phone the
 * server counted in that zone, fixed from then on (a pulse in a zone no key
 * has counted yet uses its own).
 *
 * The rolling "active now" figure is the client's: the sum of `devices` over
 * the rows whose `hour` is within the last 24 hours of the client's clock,
 * re-summed as the clock moves, so it decays with no traffic. Over 24 hours a
 * phone is counted at most twice (once per UTC day it attested in), so the
 * figure is distinct phones in the window to within that overlap.
 */
export interface SignalHourRollupRow {
  id: string;
  hour: string;
  region: string;
  timeZone: string;
  devices: number;
  pulses: number;
  updatedAt: string;
}

export type SignalActivesScope = "region" | "zone";

/**
 * Rolling active phones for one region or one time zone (0.4.0). Super
 * admins only. `id` is `${scope}|${key}` (`signalActivesId`); `key` is the
 * ISO region code for scope `region`, the IANA zone for scope `zone`.
 * `region` is the key itself for scope `region`, and the zone's region for
 * scope `zone`. A zone belongs to one region, the region of the first phone
 * counted in it, and a region's rows count the phones of its zones: a phone
 * whose locale names another country counts under its zone's region.
 *
 * The arithmetic. Each day key carries `gapDays` (signals.ts): the UTC days
 * since that phone's previous active day, or null for never. So a phone
 * active on day d with gap g was previously active on d minus g, and on no
 * day in between. For a window of W UTC days ending today T, starting
 * S = T - (W - 1), the phone is NEW to the window on day d (in the window)
 * iff g is null or d - g < S: its previous active day is outside the window,
 * so d is its first active day inside it. Every phone active in the window
 * has exactly one such first day, so summing, over the days d from S to T,
 * the attestations on d whose gap makes them new to the window, counts each
 * phone active in the window exactly once, however many days it was active.
 *
 *  - `active7d`: distinct phones active in the last 7 UTC days, today
 *    included (S = T - 6).
 *  - `active30d`: the same over the last 30 UTC days (S = T - 29). A gap of
 *    30 (30 or more) is new to both windows on any day in them.
 *  - `newToday`: attestations today with gap null: phones counted for the
 *    first time ever (or after a reset on the phone).
 *
 * The server keeps per (UTC day, time zone, gap) attestation counts and
 * recomputes a row on every day key in its zone or region, and every row once
 * at the UTC day change, when the windows roll and `newToday` starts again
 * from zero. A phone attesting twice in one day (rare, a refused key) counts
 * twice. Region totals are the sum of the region-scope rows; zone rows sum to
 * the same total.
 */
export interface SignalActivesRow {
  id: string;
  scope: SignalActivesScope;
  key: string;
  region: string;
  active7d: number;
  active30d: number;
  newToday: number;
  updatedAt: string;
}

/** Row type per sync type, for typed routing on the client. */
export interface SyncRowByType {
  user: UserRow;
  signal_rollup: SignalRollupRow;
  signal_name_rollup: SignalNameRollupRow;
  signal_hour_rollup: SignalHourRollupRow;
  signal_actives: SignalActivesRow;
}

/** Build the rollup ids, so server and client never disagree on them. */
export function signalRollupId(day: string, region: string): string {
  return `${day}|${region}`;
}

export function signalNameRollupId(day: string, itemKind: string, name: string): string {
  return `${day}|${itemKind}|${name}`;
}

/** `hour` is the ISO start of the UTC hour (`2026-10-26T10:00:00.000Z`). */
export function signalHourRollupId(hour: string, timeZone: string): string {
  return `${hour}|${timeZone}`;
}

export function signalActivesId(scope: SignalActivesScope, key: string): string {
  return `${scope}|${key}`;
}
