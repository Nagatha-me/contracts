/**
 * Anonymous usage signals (design section 8). Four pre-auth REST routes, no
 * cookie, no bearer, each behind its own one-time challenge:
 *
 *   GET  /signals/challenge                       -> SignalChallengeResponse
 *   POST /signals/key     SignalKeyRequest        -> SignalKeyResponse
 *   POST /signals/pulse   SignalPulseRequest      -> SignalPulseResponse
 *   POST /signals         SignalUploadRequest     -> SignalUploadResponse
 *
 * The day key (live pulse model, owner, 26 October 2026)
 * -------------------------------------------------------
 * On its first foreground of a UTC day (0.4.0; or its first upload, when that
 * comes first) the phone generates an App Attest key
 * (`DCAppAttestService.generateKey`), fetches a challenge and attests the key
 * with `clientDataHash = sha256(challengeBytes)`, where `challengeBytes` is the
 * challenge decoded from base64url (32 bytes). `POST /signals/key` verifies the
 * attestation against Apple's App Attestation root and keeps ONLY the key id,
 * the public key, the assertion counter and a per-key pulse count, until
 * `expiresAt` (24 hours after the attestation). A key id is attested once; a
 * second attestation of the same key id is 409 CONFLICT.
 *
 * The key request carries `context` (0.4.0): the full document context
 * (`appBuild`, `osMajor`, `deviceClass`, `language`, `region`, `timeZone`)
 * plus `gapDays`, the whole UTC days since this phone was last counted active
 * (1 to 30, 30 meaning 30 or more), or `null` when it has never been counted.
 * On a successful attestation the server, in the same transaction that stores
 * the key: adds 1 to `devices` on the daily rollup for (today UTC, region);
 * adds 1 to `devices` on the hour rollup for (this UTC hour, time zone); adds
 * 1 to the gap rollup for (today UTC, time zone, gap); recomputes the zone's
 * and the region's rolling actives (`SignalActivesRow`, rows.ts) from the gap
 * rollups; and broadcasts the hour rollup and both actives rows. The context
 * goes on those counters only, never on the key row, and nothing about it is
 * kept per phone. The gap is one number, never a date, so it says how many
 * distinct phones were active in a window without linking any two days.
 *
 * The phone's rules (0.4.0), exactly:
 *  - A day is a UTC calendar day, the same day the server counts in. The
 *    phone attests one key per UTC day, as soon as the app first comes to the
 *    foreground in that day with sharing on (scene phase `active`), before
 *    any pulse and without waiting for one, so a person who opens the app is
 *    counted at once. If the first upload of the day happens in the
 *    background first (a nag answered from a notification), that upload
 *    attests the key instead. Never more than one accepted attestation a UTC
 *    day.
 *  - It keeps `lastActiveDay`, the UTC day (`YYYY-MM-DD`) of its last
 *    ACCEPTED attestation, and `lastGapDays`, the gap it sent then, in the
 *    Keychain beside the install secret: this device only, never backed up,
 *    never synced, never sent. Both are written only when the server answers
 *    200 (or 409 CONFLICT, which means that key was already counted). A
 *    refused or failed attestation changes neither.
 *  - `gapDays` = `signalGapDays(lastActiveDay, today)`: `null` when there is
 *    no `lastActiveDay` (first ever, a restore onto a new phone, or after
 *    "Delete and start fresh", which clears both values with the install
 *    secret); `null` too when `lastActiveDay` is after today (the clock went
 *    back: the history is not trusted, and the next accepted attestation
 *    resets it); otherwise the day difference, capped at 30.
 *  - A second attestation on the same UTC day (the first key was refused
 *    later with KEY_UNKNOWN) sends `lastGapDays` again, the gap the day
 *    started with. The server then counts the phone twice that day; this is
 *    rare and the cost of keeping no identity.
 *  - With sharing off the phone attests nothing and keeps its stored day, so
 *    the gap on its return measures from the last day it was counted.
 *
 * Test vectors for `signalGapDays` (also in test/signals.test.mjs):
 *   (null, 2026-10-26) -> null; (2026-10-25, 2026-10-26) -> 1;
 *   (2026-09-26, 2026-10-26) -> 30; (2026-01-01, 2026-10-26) -> 30;
 *   (2026-10-27, 2026-10-26) -> null.
 *
 * Every later upload that day, pulse or program document, fetches a fresh
 * challenge and is signed with that key by an assertion
 * (`DCAppAttestService.generateAssertion(keyId, clientDataHash)`) over
 *
 *   clientDataHash = sha256(challengeBytes || sha256(documentBytes))
 *
 * where `documentBytes` are the exact UTF-8 bytes of the `document` string
 * sent in the body. The server checks, in order: the challenge is live and
 * consumes it; the document parses and validates; the key is known (404
 * KEY_UNKNOWN) and unexpired (410 KEY_EXPIRED); the assertion is CBOR
 * `{ signature, authenticatorData }`, the signature is ECDSA P-256 with
 * SHA-256 over `nonce = sha256(authenticatorData || clientDataHash)` under the
 * stored public key, and authenticatorData's rpIdHash is sha256 of the app id
 * (400 ASSERTION_INVALID otherwise); the sign counter in authenticatorData is
 * greater than the stored one (409 COUNTER_REPLAY) and the key has signed
 * fewer than `SIGNAL_KEY_DAILY_UPLOADS` uploads (429 KEY_QUOTA). The new
 * counter is stored. Nothing about the key is written to any document or
 * rollup row, and nothing links one key to the next.
 *
 * When a key is refused with KEY_UNKNOWN or KEY_EXPIRED the phone mints and
 * attests a new key and retries. On KEY_QUOTA it holds its pulses until the
 * next key. On COUNTER_REPLAY it drops that upload. When the endpoint is away,
 * pulses are queued on the phone and dropped after seven days.
 *
 * Program tokens (0.3.0)
 * ----------------------
 * A program carries two rotating tokens, `weekToken` and `monthToken`, in
 * place of the stable token of 0.2.0. The phone derives them; this is its
 * rule, exactly:
 *
 *   weekToken  = base64url(sha256(installSecret || programId || week))[0..<32]
 *   monthToken = base64url(sha256(installSecret || programId || month))[0..<32]
 *
 *  - `installSecret`: 32 random bytes made once per install with the system's
 *    secure random generator, kept in the Keychain on this device only, never
 *    sent, never backed up, never synced. "Delete and start fresh" makes a new
 *    one.
 *  - `programId`: the UTF-8 bytes of the program's id as the phone stores it
 *    (Swift `UUID.uuidString`, upper case with hyphens).
 *  - `week`: the ISO 8601 week of the moment the upload is built, in UTC, as
 *    ASCII `YYYY-Www` (ISO week-numbering year, `W`, two-digit week), for
 *    example `2026-W44`. `month`: the UTC calendar month, `YYYY-MM`, for
 *    example `2026-10`. `programPeriods` below computes both.
 *  - `||` is byte concatenation with no separator. sha256 gives 32 bytes;
 *    base64url is RFC 4648 section 5 without padding (43 characters); the
 *    token is its first 32 characters.
 *
 * Test vector (also in test/signals.test.mjs): installSecret = 32 bytes of
 * 0x01, programId = `3F2504E0-4F89-41D3-9D0A-0305E82C3301`:
 *   week `2026-W44` -> `zhmS2alIKLI4o5p_Z44tR51pOwfp-XSz`
 *   month `2026-10` -> `Z5hW5C_oDizW5aXx6fhkIVN7gOVGS2Xn`
 *
 * The tokens are derived when the upload is sent, not when the event
 * happened, so a pulse queued over a week boundary carries the tokens of the
 * week it is sent in. The server takes the periods from its own UTC clock at
 * receipt. A token is stable for one program within one period and nothing
 * links it to the next period's token, so nothing links two uploads across a
 * calendar month. For counting, the server keeps sha256 of each token, with
 * its period and the region it was first seen in, and deletes it two periods
 * later. A stored program document keeps its programs' tokens for the same
 * two months (0.5.0): a nightly job folds each program's month into a derived
 * series row with no token in its id, then sets `weekToken` and `monthToken`
 * to null in every document older than the month before last.
 * The schema accepts 22 to 44 base64url characters so the length can change
 * without a contract break.
 *
 * Pulses
 * ------
 * A pulse is a `PulseDocumentV1`: one event kind, the local hour and weekday,
 * the context, the program's `weekToken` and `monthToken` for a run (both or
 * neither), and `count`, the events of that kind coalesced over one minute
 * (1 to 60). The server stores no pulse row: it adds 1 to the day-and-region
 * rollup's `pulses` and `count` to the kind's counter, records the tokens'
 * first sightings (`newProgramsWeek`, `newProgramsMonth`), adds 1 to
 * `pulses` on the hour rollup for (this UTC hour, its time zone) (0.4.0),
 * then broadcasts both rows.
 *
 * Program documents
 * -----------------
 * `SignalDocumentV1`, once a day or when a program changes, signed with the
 * day key the same way. The phone scrubs the document before it leaves (three
 * layers, on device). These schemas are the server's second line: strict keys,
 * bounded arrays, a cap on the whole document's items and routine blocks,
 * every name capped at 60 characters, no control characters in any string,
 * every number in a plausible range.
 *
 * Pulses own the live counters (0.3.0). A program document is stored whole,
 * with its weekly counts and histograms, and adds to the rollup only
 * `uploads` (1), `programs` (its program count), the name rollups and the
 * first sightings of its programs' tokens. Its weekly `nagsShown`,
 * `nagsCompleted`, `runsStarted` and `runsFinished` are NOT added to the
 * rollup any more, so a run reported by a pulse and again in the week's
 * document counts once.
 *
 * Item names count distinct programs (0.5.0): for each item name the server
 * records the pair (month, sha256(name), sha256(monthToken)) once, and the
 * name rollup's `count` is the number of distinct month tokens that carried
 * the name in the row's month; `uploads` keeps the old count of occurrences.
 * A name row reaches an admin, by sync or broadcast, only at
 * `NAME_ROLLUP_MIN_CONTRIBUTORS` (k = 10) or more (rows.ts).
 *
 * Error codes (beside 429 RATE_LIMITED from the per-IP limiter): INVALID,
 * CHALLENGE_INVALID, DOCUMENT_INVALID, ATTESTATION_INVALID, ASSERTION_INVALID
 * (each 400), KEY_UNKNOWN (404), KEY_EXPIRED (410), COUNTER_REPLAY (409),
 * CONFLICT (409, key already attested), KEY_QUOTA (429), NOT_YET (501, Android).
 */

/**
 * Purposes (0.5.0): what the numbers may be used for
 * --------------------------------------------------
 * Consent has three purposes, sent as `purposes` (`SignalPurposes`) on the
 * day key's context and at the top of every program document, and kept by
 * the server as a bitmask (`SIGNAL_PURPOSE_BITS`, `signalPurposesMask`):
 *
 *   improve  = 1  making Nagatha better: internal analysis by the people who
 *                 make her. "Continue" on the first-launch screen says yes to
 *                 this, and only this. Always set: with sharing off nothing
 *                 is sent at all.
 *   publish  = 2  being counted in totals we publish (a study, a post, the
 *                 website), at least 50 contributors a figure, 100 for
 *                 health-adjacent cohorts (rehab, quit, medication). Its own
 *                 switch, off until the person turns it on.
 *   research = 4  being counted in aggregate totals shared with researchers,
 *                 at the same thresholds, never row-level data. Its own
 *                 switch, off until the person turns it on.
 *
 * `consentVersion` is the version of the consent screen the person answered:
 * 1: the first consent screen, improve only, no switches (installs in the
 * field already carry this); 2: adds the publish and research switches. The
 * numbering is fixed. The phone keeps its answers and the version on the
 * device, beside the install secret, and sends what the person agreed to;
 * `publish` and `research` are false unless chosen.
 *
 * The rule, for the server and anything downstream of it:
 *  - The server keeps the mask and `consentVersion` on the day key's row for
 *    its 24 hours, and stamps the mask on everything that key signs: each
 *    document row, and each counter a pulse, document or attestation adds to.
 *    A document whose own `purposes` disagrees with its key's is stamped with
 *    the intersection of the two (bitwise AND), so a bit counts only when
 *    both say it.
 *  - The plain rollup counters count everything. The `*Publish` and
 *    `*Research` counters (rows.ts `SignalRollupRow`) count only what came
 *    with that bit. An upload without a bit never enters an aggregate for
 *    that purpose, published or shared.
 *  - Consent given before the switches existed carries no bits beyond
 *    improve: a 0.4.0 phone sends no `purposes`, and its key and documents
 *    are treated as improve only with `consentVersion` 0; a `consentVersion`
 *    of 1 is improve only too, both bits off whatever the bits say, because
 *    that screen had no switches. Only version 2 and later can carry publish
 *    or research. Nothing collected before 0.5.0 ever enters a published or
 *    shared total.
 *  - Three bits add no link between days or uploads: every phone with the
 *    same answers sends the same mask.
 *
 * Richer document fields (0.5.0), each optional so older phones validate:
 * the chosen `voice` (a persona id from the app's list, or "other"); per item
 * `weekDone`, the runs finished this ISO week (0 to 200); per program
 * `currentStage`, the index of the stage it is in; and per abstain item
 * `streakBand`, the current streak as a band ("0", "1-3", "4-7", "8-30",
 * "31+"), never the exact days.
 */

import { z } from "zod";

export const SIGNAL_CHALLENGE_TTL_SECONDS = 120;
/** A day key lives this long after its attestation. */
export const SIGNAL_KEY_TTL_SECONDS = 24 * 60 * 60;
/** Uploads (pulses and program documents together) one day key may sign. */
export const SIGNAL_KEY_DAILY_UPLOADS = 200;
/** The most events of one kind a pulse may coalesce (one minute's worth). */
export const PULSE_COUNT_MAX = 60;
export const SIGNAL_NAME_MAX = 60;

/** Across the whole document: items in every stage of every program. */
export const MAX_DOCUMENT_ITEMS = 400;
/** Across the whole document: routine blocks, counting those inside groups. */
export const MAX_DOCUMENT_ROUTINE_BLOCKS = 2_000;

/** The program token periods for an instant, both in UTC (see "Program tokens" at the top). */
export interface ProgramPeriods {
  /** ISO 8601 week, `YYYY-Www`, for example `2026-W44`. */
  week: string;
  /** Calendar month, `YYYY-MM`, for example `2026-10`. */
  month: string;
}

/** The UTC ISO week and UTC month of `at`, as the program tokens use them. */
export function programPeriods(at: Date): ProgramPeriods {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // ISO weeks start on Monday; the week belongs to the year of its Thursday.
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const thursday = new Date(day.getTime() + (4 - weekday) * 86_400_000);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * 86_400_000)) + 1;
  const month = at.getUTCMonth() + 1;
  return {
    week: `${isoYear}-W${String(week).padStart(2, "0")}`,
    month: `${at.getUTCFullYear()}-${String(month).padStart(2, "0")}`,
  };
}

/** True when `s` holds no C0 control character (U+0000 to U+001F) and no DEL (U+007F). */
export function hasNoControlCharacters(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  return true;
}

const NO_CONTROL = "control characters are not allowed";

/** A string that may not hold control characters; every string field starts here. */
const text = () => z.string().refine(hasNoControlCharacters, NO_CONTROL);

const name = z.string().trim().min(1).max(SIGNAL_NAME_MAX).refine(hasNoControlCharacters, NO_CONTROL);
const count = (max: number) => z.number().int().min(0).max(max);

/** `YYYY-MM-DD` that is also a real calendar date. */
const isoDay = text()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a calendar date");

/** `HH:MM`, 24 hour. */
const clockTime = text().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** ISO 3166-1 alpha-2 from the device locale, or `ZZ` when unknown. Never from the IP. */
const regionCode = text().regex(/^[A-Z]{2}$/);
/** IANA time zone id, for example `Australia/Sydney`. */
const timeZoneId = text()
  .min(1)
  .max(64)
  .regex(/^(UTC|GMT|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/);

export const SignalContext = z.strictObject({
  appBuild: text().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  osMajor: z.number().int().min(10).max(60),
  deviceClass: text().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  /** BCP 47 language tag, for example `en-AU`. */
  language: text().min(2).max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/),
  region: regionCode,
  timeZone: timeZoneId,
});
export type SignalContext = z.infer<typeof SignalContext>;

/** The purposes bitmask (0.5.0; see "Purposes" above). */
export const SIGNAL_PURPOSE_BITS = Object.freeze({ improve: 1, publish: 2, research: 4 } as const);
/** The mask a phone that sent no `purposes` (0.4.0 and before) is treated as having: improve only. */
export const SIGNAL_PURPOSES_LEGACY_MASK = SIGNAL_PURPOSE_BITS.improve;
/** The `consentVersion` the server records for a phone that sent no `purposes`. */
export const SIGNAL_CONSENT_VERSION_LEGACY = 0;
/** The first `consentVersion` whose screen has the publish and research switches. Version 1 had none. */
export const SIGNAL_CONSENT_VERSION_SWITCHES = 2;
/** The highest `consentVersion` accepted (it is kept as a smallint). */
export const SIGNAL_CONSENT_VERSION_MAX = 32_767;

/**
 * What the person agreed to (0.5.0). `improve` is always true (Continue);
 * `publish` and `research` are the two switches, false unless chosen.
 * Strict.
 */
export const SignalPurposes = z.strictObject({
  improve: z.literal(true),
  publish: z.boolean().default(false),
  research: z.boolean().default(false),
  consentVersion: z.number().int().min(1).max(SIGNAL_CONSENT_VERSION_MAX),
});
export type SignalPurposes = z.infer<typeof SignalPurposes>;

/**
 * The bitmask for a parsed `purposes`: the legacy improve-only mask when
 * there is none, and also for `consentVersion` 1 (a screen with no switches),
 * whatever its bits say.
 */
export function signalPurposesMask(
  p: Pick<SignalPurposes, "publish" | "research" | "consentVersion"> | undefined | null,
): number {
  if (!p || p.consentVersion < SIGNAL_CONSENT_VERSION_SWITCHES) return SIGNAL_PURPOSES_LEGACY_MASK;
  return SIGNAL_PURPOSE_BITS.improve | (p.publish ? SIGNAL_PURPOSE_BITS.publish : 0) | (p.research ? SIGNAL_PURPOSE_BITS.research : 0);
}

/** True when `mask` carries `bit`. */
export function hasSignalPurpose(mask: number, bit: keyof typeof SIGNAL_PURPOSE_BITS): boolean {
  return (mask & SIGNAL_PURPOSE_BITS[bit]) !== 0;
}

/**
 * The persona ids of the app's voice list (`ios/Nagatha/Resources/Vocab.json`),
 * plus "other" for a voice this list does not know yet (0.5.0). The app is
 * Nagatha whichever voice is chosen; this says which manner, never who.
 */
export const SignalVoice = z.enum([
  "nagatha",
  "gentle",
  "sarcastic",
  "supernag",
  "painInMyBum",
  "sassy",
  "sergeant",
  "coach",
  "mum",
  "rude",
  "flirt",
  "dominant",
  "submissive",
  "roast",
  "plain",
  "other",
]);
export type SignalVoice = z.infer<typeof SignalVoice>;

/** An abstain item's current streak, as a band (0.5.0). */
export const StreakBand = z.enum(["0", "1-3", "4-7", "8-30", "31+"]);
export type StreakBand = z.infer<typeof StreakBand>;

/** The most runs one item may report finished in one week (`weekDone`). */
export const ITEM_WEEK_DONE_MAX = 200;

export const ItemKind = z.enum(["timed", "count", "tick", "checkIn", "abstain"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const CadenceKind = z.enum(["spread", "fixed", "weekdays", "weekly", "deadline", "daily"]);

export const SignalCadence = z.strictObject({
  kind: CadenceKind,
  timesPerDay: z.number().int().min(1).max(48).optional(),
  fixedTimes: z.array(clockTime).min(1).max(24).optional(),
  weekdayCount: z.number().int().min(1).max(7).optional(),
  deadlineLeadDays: z.number().int().min(0).max(365).optional(),
});

/** A routine block (design section 14). Groups nest one level only. */
const StepBlock = z.strictObject({
  kind: z.literal("step"),
  words: name,
  seconds: z.number().int().min(0).max(3600),
});
const MoveBlock = z.strictObject({
  kind: z.literal("move"),
  words: name,
  count: z.number().int().min(1).max(1000),
  seconds: z.number().int().min(0).max(3600).optional(),
});
const RestBlock = z.strictObject({
  kind: z.literal("rest"),
  seconds: z.number().int().min(0).max(3600),
});
const LeafBlock = z.discriminatedUnion("kind", [StepBlock, MoveBlock, RestBlock]);
const GroupBlock = z.strictObject({
  kind: z.literal("group"),
  repeat: z.number().int().min(1).max(100),
  switchSides: z.boolean(),
  blocks: z.array(LeafBlock).min(1).max(30),
});
export const RoutineBlock = z.discriminatedUnion("kind", [StepBlock, MoveBlock, RestBlock, GroupBlock]);
export type RoutineBlock = z.infer<typeof RoutineBlock>;

export const MAX_ROUTINE_BLOCKS = 30;

/** Blocks in a routine, counting those inside groups. */
function routineBlockCount(blocks: readonly RoutineBlock[]): number {
  return blocks.reduce((n, b) => n + 1 + (b.kind === "group" ? b.blocks.length : 0), 0);
}

export const SignalRoutine = z
  .strictObject({ blocks: z.array(RoutineBlock).min(1).max(MAX_ROUTINE_BLOCKS) })
  .refine(
    (r) => routineBlockCount(r.blocks) <= MAX_ROUTINE_BLOCKS,
    `a routine holds at most ${MAX_ROUTINE_BLOCKS} blocks, counting those inside groups`,
  );

export const SignalItem = z
  .strictObject({
    name,
    kind: ItemKind,
    cadence: SignalCadence,
    routine: SignalRoutine.optional(),
    /** Runs of this item finished this ISO week, 0 to 200 (0.5.0). */
    weekDone: z.number().int().min(0).max(ITEM_WEEK_DONE_MAX).optional(),
    /** Abstain items only: the current streak as a band (0.5.0). */
    streakBand: StreakBand.optional(),
  })
  .refine((item) => item.streakBand === undefined || item.kind === "abstain", {
    path: ["streakBand"],
    message: "a streak band rides only on abstain items",
  });
export type SignalItem = z.infer<typeof SignalItem>;

export const StageExitKind = z.enum(["date", "doneCount", "streak", "checkpoint", "manual"]);

export const SignalStage = z.strictObject({
  name,
  /** How the stage ends. `n` is the done count or streak days where the kind has one. */
  exit: z.strictObject({ kind: StageExitKind, n: z.number().int().min(1).max(3650).optional() }),
  items: z.array(SignalItem).max(40),
});

export const ProgramKind = z.enum(["rehab", "habit", "routine", "project", "quit", "custom"]);
export const ProgramSource = z.enum(["hand", "template", "onboarding", "reminders", "sheet"]);

/** A rotating program token (see "Program tokens" at the top): 22 to 44 base64url characters. */
const programToken = text().regex(/^[A-Za-z0-9_-]{22,44}$/);

export const SignalProgram = z.strictObject({
  /** This program's token for the current UTC ISO week. */
  weekToken: programToken,
  /** This program's token for the current UTC month. */
  monthToken: programToken,
  name,
  kind: ProgramKind,
  source: ProgramSource,
  templateId: text().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(),
  ageWeeks: z.number().int().min(0).max(1040),
  keptAt: z.strictObject({ d7: z.boolean(), d30: z.boolean(), d90: z.boolean() }),
  stages: z.array(SignalStage).min(1).max(10),
  /** The index into `stages` of the stage the program is in now (0.5.0). */
  currentStage: z.number().int().min(0).max(9).optional(),
}).refine((p) => p.currentStage === undefined || p.currentStage < p.stages.length, {
  path: ["currentStage"],
  message: "the current stage must be one of the program's stages",
});
export type SignalProgram = z.infer<typeof SignalProgram>;

export const SignalEventCounts = z.strictObject({
  nagsShown: count(20_000),
  nagsCompleted: count(20_000),
  runsStarted: count(20_000),
  runsFinished: count(20_000),
  snoozes: count(20_000),
  skips: count(20_000),
  shares: count(5_000),
  laughs: count(5_000),
  lineGenerations: count(20_000),
});
export type SignalEventCounts = z.infer<typeof SignalEventCounts>;

export const SignalEvents = z.strictObject({
  /** Monday of the week the counts cover. */
  weekStart: isoDay,
  counts: SignalEventCounts,
  hourOfDay: z.array(count(20_000)).length(24),
  weekday: z.array(count(20_000)).length(7),
});

export const SignalDocumentV1 = z
  .strictObject({
    version: z.literal(1),
    context: SignalContext,
    /**
     * What the person agreed to (0.5.0). A 0.5.0 phone always sends it; a
     * document without it (0.4.0) is improve only, consent version 0.
     */
    purposes: SignalPurposes.optional(),
    /** The chosen voice's persona id (0.5.0). */
    voice: SignalVoice.optional(),
    programs: z.array(SignalProgram).max(20),
    events: SignalEvents,
  })
  .superRefine((doc, ctx) => {
    // The per-array caps alone allow 20 x 10 x 40 items and 30 blocks each;
    // these bound the whole document, whatever its shape.
    let items = 0;
    let blocks = 0;
    for (const program of doc.programs) {
      for (const stage of program.stages) {
        items += stage.items.length;
        for (const item of stage.items) if (item.routine) blocks += routineBlockCount(item.routine.blocks);
      }
    }
    if (items > MAX_DOCUMENT_ITEMS) {
      ctx.addIssue({ code: "custom", path: ["programs"], message: `a document holds at most ${MAX_DOCUMENT_ITEMS} items` });
    }
    if (blocks > MAX_DOCUMENT_ROUTINE_BLOCKS) {
      ctx.addIssue({
        code: "custom",
        path: ["programs"],
        message: `a document holds at most ${MAX_DOCUMENT_ROUTINE_BLOCKS} routine blocks, counting those inside groups`,
      });
    }
  });
export type SignalDocumentV1 = z.infer<typeof SignalDocumentV1>;

// ------------------------------------------------------------
// Pulses
// ------------------------------------------------------------

/** The event kinds a pulse may carry. `run.*` kinds may carry the program tokens. */
export const PulseKind = z.enum([
  "run.finished",
  "run.started",
  "nag.shown",
  "nag.completed",
  "nag.snoozed",
  "nag.skipped",
  "line.shared",
  "line.laughed",
]);
export type PulseKind = z.infer<typeof PulseKind>;

export const PulseDocumentV1 = z
  .strictObject({
    version: z.literal(1),
    kind: PulseKind,
    /**
     * When the events happened, on the phone's clock in its own time zone:
     * `hour` 0 to 23, `weekday` 0 Sunday to 6 Saturday (iOS `weekday` minus 1).
     */
    at: z.strictObject({
      hour: z.number().int().min(0).max(23),
      weekday: z.number().int().min(0).max(6),
    }),
    context: SignalContext,
    /** The program's week token, for `run.*` kinds only, always with `monthToken`. */
    weekToken: programToken.optional(),
    /** The program's month token, for `run.*` kinds only, always with `weekToken`. */
    monthToken: programToken.optional(),
    /** Events of this kind coalesced over one minute. */
    count: z.number().int().min(1).max(PULSE_COUNT_MAX),
  })
  .superRefine((doc, ctx) => {
    const week = doc.weekToken !== undefined;
    const month = doc.monthToken !== undefined;
    if ((week || month) && !doc.kind.startsWith("run.")) {
      ctx.addIssue({ code: "custom", path: [week ? "weekToken" : "monthToken"], message: "program tokens ride only on run kinds" });
    }
    if (week !== month) {
      ctx.addIssue({ code: "custom", path: [week ? "monthToken" : "weekToken"], message: "the week and month tokens go together" });
    }
  });
export type PulseDocumentV1 = z.infer<typeof PulseDocumentV1>;

// ------------------------------------------------------------
// Requests and responses
// ------------------------------------------------------------

/** `GET /signals/challenge` response. */
export interface SignalChallengeResponse {
  /** base64url of 32 random bytes. Single use: one challenge per key, pulse or document. */
  challenge: string;
  expiresInSeconds: typeof SIGNAL_CHALLENGE_TTL_SECONDS;
}

const challenge = text().regex(/^[A-Za-z0-9_-]{43}$/);
/** base64 of sha256 of the attested public key (32 bytes), as DCAppAttestService returns it. */
const keyId = text().regex(/^[A-Za-z0-9+/]{43}=$/);
/**
 * The JSON text of the signed document, sent as a string so the server
 * hashes exactly the bytes the phone hashed. The one string exempt from the
 * control character rule: JSON text may carry tabs and newlines between
 * tokens. Every string inside it is checked once it is parsed.
 */
const documentText = (max: number) => z.string().min(2).max(max);
/** base64 of the CBOR assertion object `{ signature, authenticatorData }`. */
const assertion = text().min(1).max(4_096);

/** The cap on `gapDays`: 30 means 30 days or more since the phone was last counted. */
export const SIGNAL_GAP_DAYS_MAX = 30;

/**
 * `SignalKeyRequest.context` (0.4.0): the full `SignalContext` plus `gapDays`,
 * an integer 1 to 30 (days since this phone was last counted active, capped
 * at 30) or `null` (never counted before), and (0.5.0) `purposes`. Strict.
 */
export const SignalKeyContext = z.strictObject({
  ...SignalContext.shape,
  gapDays: z.number().int().min(1).max(SIGNAL_GAP_DAYS_MAX).nullable(),
  /**
   * What the person agreed to (0.5.0). A 0.5.0 phone always sends it; a key
   * without it (0.4.0) is improve only, consent version 0.
   */
  purposes: SignalPurposes.optional(),
});
export type SignalKeyContext = z.infer<typeof SignalKeyContext>;

/**
 * The phone's `gapDays` for a first attestation on UTC day `today`, from the
 * UTC day of its last accepted attestation (see "The phone's rules" at the
 * top). Both days are `YYYY-MM-DD`. `null` for no history or a history in the
 * future; otherwise the whole days between, capped at 30. Throws when the two
 * days are equal: a second attestation the same day resends the day's first
 * gap and never calls this.
 */
export function signalGapDays(lastActiveDay: string | null, today: string): number | null {
  if (lastActiveDay === null) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastActiveDay}T00:00:00Z`)) / 86_400_000);
  if (Number.isNaN(days)) throw new RangeError("not a calendar day");
  if (days === 0) throw new RangeError("already counted today: resend the day's first gap");
  if (days < 0) return null;
  return Math.min(days, SIGNAL_GAP_DAYS_MAX);
}

/**
 * `POST /signals/key` body: attest today's key. The attestation's
 * clientDataHash is `sha256(challengeBytes)`; no document is bound.
 * `context` (0.4.0, required) is the full context plus `gapDays`; it counts
 * the phone in the daily, hourly and rolling active counts, and nowhere else.
 */
export const SignalKeyRequest = z.strictObject({
  challenge,
  keyId,
  /** base64 of the CBOR attestation object. */
  attestation: text().min(1).max(20_000),
  context: SignalKeyContext,
});
export type SignalKeyRequest = z.infer<typeof SignalKeyRequest>;

/** `POST /signals/key` success. */
export interface SignalKeyResponse {
  accepted: true;
  /** ISO 8601 UTC: the key is refused with KEY_EXPIRED from this instant. */
  expiresAt: string;
}

/**
 * `POST /signals/pulse` body. `document` is the JSON text of a
 * `PulseDocumentV1`; `assertion` signs
 * `sha256(challengeBytes || sha256(documentBytes))` with the day key.
 */
export const SignalPulseRequest = z.strictObject({
  challenge,
  keyId,
  assertion,
  document: documentText(4 * 1024),
});
export type SignalPulseRequest = z.infer<typeof SignalPulseRequest>;

/** `POST /signals/pulse` success. */
export interface SignalPulseResponse {
  accepted: true;
}

/**
 * `POST /signals` body: a program document. `document` is the JSON text of a
 * `SignalDocumentV1`, signed with the day key by an assertion over
 * `sha256(challengeBytes || sha256(documentBytes))`. There is no per-upload
 * attestation (0.2.0).
 */
export const SignalUploadRequest = z.strictObject({
  platform: z.enum(["ios", "android"]),
  challenge,
  keyId,
  assertion,
  document: documentText(512 * 1024),
});
export type SignalUploadRequest = z.infer<typeof SignalUploadRequest>;

/** `POST /signals` success. Failures are a `RestErrorBody` with a code below. */
export interface SignalUploadResponse {
  accepted: true;
}

/**
 * The codes the signal routes answer with, beside RATE_LIMITED (429) and
 * CONFLICT (409, a key id attested twice). HTTP status in brackets.
 */
export const SignalErrorCode = {
  /** [400] The body does not match the request schema. */
  Invalid: "INVALID",
  /** [400] The challenge is unknown, used or expired. Fetch a new one. */
  ChallengeInvalid: "CHALLENGE_INVALID",
  /** [400] The document is not JSON or fails its schema. */
  DocumentInvalid: "DOCUMENT_INVALID",
  /** [400] `POST /signals/key`: the attestation failed verification. */
  AttestationInvalid: "ATTESTATION_INVALID",
  /** [400] The assertion is not CBOR, the signature fails, or the app id differs. */
  AssertionInvalid: "ASSERTION_INVALID",
  /** [404] No live key with this id. Attest a new key. */
  KeyUnknown: "KEY_UNKNOWN",
  /** [410] The key's 24 hours are over. Attest a new key. */
  KeyExpired: "KEY_EXPIRED",
  /** [409] The assertion's counter is not above the last one accepted. Drop the upload. */
  CounterReplay: "COUNTER_REPLAY",
  /** [429] The key has signed its `SIGNAL_KEY_DAILY_UPLOADS`. Wait for the next key. */
  KeyQuota: "KEY_QUOTA",
  /** [501] Android, until Play Integrity lands. */
  NotYet: "NOT_YET",
} as const;
export type SignalErrorCode = (typeof SignalErrorCode)[keyof typeof SignalErrorCode];
