/**
 * Anonymous usage signals (design section 8). Two pre-auth REST routes, no
 * cookie, no bearer:
 *
 *   GET  /signals/challenge -> SignalChallengeResponse
 *   POST /signals           SignalUploadRequest -> SignalUploadResponse
 *
 * The phone scrubs the document before it leaves (three layers, on device).
 * This schema is the server's second line: strict keys, bounded arrays, every
 * name capped at 60 characters, every number in a plausible range.
 */

import { z } from "zod";

export const SIGNAL_CHALLENGE_TTL_SECONDS = 120;
export const SIGNAL_NAME_MAX = 60;

const name = z.string().trim().min(1).max(SIGNAL_NAME_MAX);
const count = (max: number) => z.number().int().min(0).max(max);

/** `YYYY-MM-DD` that is also a real calendar date. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a calendar date");

/** `HH:MM`, 24 hour. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SignalContext = z.strictObject({
  appBuild: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  osMajor: z.number().int().min(10).max(60),
  deviceClass: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  /** BCP 47 language tag, for example `en-AU`. */
  language: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/),
  /** ISO 3166-1 alpha-2 from the device locale, or `ZZ` when unknown. Never from the IP. */
  region: z.string().regex(/^[A-Z]{2}$/),
  /** IANA time zone id, for example `Australia/Sydney`. */
  timeZone: z
    .string()
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

export const SignalRoutine = z
  .strictObject({ blocks: z.array(RoutineBlock).min(1).max(MAX_ROUTINE_BLOCKS) })
  .refine(
    (r) =>
      r.blocks.reduce((n, b) => n + 1 + (b.kind === "group" ? b.blocks.length : 0), 0) <=
      MAX_ROUTINE_BLOCKS,
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
  token: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  name,
  kind: ProgramKind,
  source: ProgramSource,
  templateId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(),
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

export const SignalDocumentV1 = z.strictObject({
  version: z.literal(1),
  context: SignalContext,
  programs: z.array(SignalProgram).max(20),
  events: SignalEvents,
});
export type SignalDocumentV1 = z.infer<typeof SignalDocumentV1>;

/** `GET /signals/challenge` response. */
export interface SignalChallengeResponse {
  /** base64url of 32 random bytes. Single use. */
  challenge: string;
  expiresInSeconds: typeof SIGNAL_CHALLENGE_TTL_SECONDS;
}

/**
 * `POST /signals` body. `document` is the JSON text of a `SignalDocumentV1`,
 * sent as a string so the server hashes exactly the bytes the phone hashed.
 *
 * The App Attest clientDataHash is `sha256(challengeBytes || sha256(documentBytes))`,
 * where `challengeBytes` is the decoded challenge and `documentBytes` the UTF-8
 * bytes of `document`. That binds the document to the attestation, so no
 * separate assertion is sent.
 */
export const SignalUploadRequest = z.strictObject({
  platform: z.enum(["ios", "android"]),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** base64 of sha256 of the attested public key, as DCAppAttestService returns it. */
  keyId: z.string().min(1).max(100),
  /** base64 of the CBOR attestation object. */
  attestation: z.string().min(1).max(20_000),
  document: z.string().min(2).max(512 * 1024),
});
export type SignalUploadRequest = z.infer<typeof SignalUploadRequest>;

/** `POST /signals` success. Failures are a `RestErrorBody` with a code below. */
export interface SignalUploadResponse {
  accepted: true;
}

/** The codes `POST /signals` may answer with, beside RATE_LIMITED (429). */
export const SignalErrorCode = {
  Invalid: "INVALID",
  ChallengeInvalid: "CHALLENGE_INVALID",
  DocumentInvalid: "DOCUMENT_INVALID",
  AttestationInvalid: "ATTESTATION_INVALID",
  NotYet: "NOT_YET",
} as const;
export type SignalErrorCode = (typeof SignalErrorCode)[keyof typeof SignalErrorCode];
