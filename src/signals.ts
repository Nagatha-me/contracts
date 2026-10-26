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
 * On the first upload of a day the phone generates an App Attest key
 * (`DCAppAttestService.generateKey`), fetches a challenge and attests the key
 * with `clientDataHash = sha256(challengeBytes)`, where `challengeBytes` is the
 * challenge decoded from base64url (32 bytes). `POST /signals/key` verifies the
 * attestation against Apple's App Attestation root and keeps ONLY the key id,
 * the public key, the assertion counter and a per-key pulse count, until
 * `expiresAt` (24 hours after the attestation). A key id is attested once; a
 * second attestation of the same key id is 409 CONFLICT.
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
 * Pulses
 * ------
 * A pulse is a `PulseDocumentV1`: one event kind, the local hour and weekday,
 * the context, a program token for a run, and `count`, the events of that
 * kind coalesced over one minute (1 to 60). The server stores no pulse row:
 * it adds 1 to the day-and-region rollup's `pulses` and `count` to the kind's
 * counter, then broadcasts the rollup row.
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
 * Error codes (beside 429 RATE_LIMITED from the per-IP limiter): INVALID,
 * CHALLENGE_INVALID, DOCUMENT_INVALID, ATTESTATION_INVALID, ASSERTION_INVALID
 * (each 400), KEY_UNKNOWN (404), KEY_EXPIRED (410), COUNTER_REPLAY (409),
 * CONFLICT (409, key already attested), KEY_QUOTA (429), NOT_YET (501, Android).
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

export const SignalContext = z.strictObject({
  appBuild: text().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  osMajor: z.number().int().min(10).max(60),
  deviceClass: text().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  /** BCP 47 language tag, for example `en-AU`. */
  language: text().min(2).max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/),
  /** ISO 3166-1 alpha-2 from the device locale, or `ZZ` when unknown. Never from the IP. */
  region: text().regex(/^[A-Z]{2}$/),
  /** IANA time zone id, for example `Australia/Sydney`. */
  timeZone: text()
    .min(1)
    .max(64)
    .regex(/^(UTC|GMT|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/),
});
export type SignalContext = z.infer<typeof SignalContext>;

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

export const SignalItem = z.strictObject({
  name,
  kind: ItemKind,
  cadence: SignalCadence,
  routine: SignalRoutine.optional(),
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

export const SignalProgram = z.strictObject({
  /** Random, changes whenever the program changes. Never ties two uploads together. */
  token: text().regex(/^[A-Za-z0-9_-]{16,32}$/),
  name,
  kind: ProgramKind,
  source: ProgramSource,
  templateId: text().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(),
  ageWeeks: z.number().int().min(0).max(1040),
  keptAt: z.strictObject({ d7: z.boolean(), d30: z.boolean(), d90: z.boolean() }),
  stages: z.array(SignalStage).min(1).max(10),
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

/** The event kinds a pulse may carry. `run.*` kinds may carry a program token. */
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

/** The program token's shape, the same as `SignalProgram.token`. */
const programToken = text().regex(/^[A-Za-z0-9_-]{16,32}$/);

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
    /** The program's current random token, for `run.*` kinds only. Never on any other kind. */
    programToken: programToken.optional(),
    /** Events of this kind coalesced over one minute. */
    count: z.number().int().min(1).max(PULSE_COUNT_MAX),
  })
  .superRefine((doc, ctx) => {
    if (doc.programToken !== undefined && !doc.kind.startsWith("run.")) {
      ctx.addIssue({ code: "custom", path: ["programToken"], message: "a program token rides only on run kinds" });
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

/**
 * `POST /signals/key` body: attest today's key. The attestation's
 * clientDataHash is `sha256(challengeBytes)`; no document is bound.
 */
export const SignalKeyRequest = z.strictObject({
  challenge,
  keyId,
  /** base64 of the CBOR attestation object. */
  attestation: text().min(1).max(20_000),
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
