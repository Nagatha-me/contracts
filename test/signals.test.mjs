import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  MAX_DOCUMENT_ITEMS,
  MAX_DOCUMENT_ROUTINE_BLOCKS,
  ErrorCode,
  PulseDocumentV1,
  SIGNAL_KEY_DAILY_UPLOADS,
  SignalDocumentV1,
  SignalErrorCode,
  SignalKeyRequest,
  SignalPulseRequest,
  SignalUploadRequest,
  hasNoControlCharacters,
  programPeriods,
  signalNameRollupId,
  verbOf,
} from "../dist/index.js";

const doc = {
  version: 1,
  context: { appBuild: "42", osMajor: 18, deviceClass: "phone", language: "en-AU", region: "AU", timeZone: "Australia/Sydney" },
  programs: [],
  events: {
    weekStart: "2026-10-19",
    counts: { nagsShown: 1, nagsCompleted: 1, runsStarted: 1, runsFinished: 1, snoozes: 0, skips: 0, shares: 0, laughs: 0, lineGenerations: 0 },
    hourOfDay: Array(24).fill(0),
    weekday: Array(7).fill(0),
  },
};

test("a minimal document parses", () => {
  assert.equal(SignalDocumentV1.safeParse(doc).success, true);
});

test("unknown keys are refused", () => {
  assert.equal(SignalDocumentV1.safeParse({ ...doc, ip: "1.2.3.4" }).success, false);
});

test("verbs derive from the suffix", () => {
  assert.equal(verbOf("signal_rollup.updated"), "UPDATED");
  assert.equal(verbOf("user.deleted"), "DELETED");
  assert.equal(verbOf("odd"), "OTHER");
});

test("name rollup ids put the name last", () => {
  assert.equal(signalNameRollupId("2026-10-26", "timed", "a|b"), "2026-10-26|timed|a|b");
});

const KEY_ID = Buffer.alloc(32, 7).toString("base64");

const pulse = {
  version: 1,
  kind: "run.finished",
  at: { hour: 7, weekday: 1 },
  context: doc.context,
  weekToken: "W".repeat(32),
  monthToken: "M".repeat(32),
  count: 1,
};

test("a pulse parses, and is strict and bounded", () => {
  assert.equal(PulseDocumentV1.safeParse(pulse).success, true);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, installId: "x" }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, count: 0 }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, count: 61 }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, at: { hour: 24, weekday: 1 } }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, at: { hour: 0, weekday: 7 } }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, kind: "app.opened" }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, context: { ...doc.context, region: "A\u0000" } }).success, false);
});

test("program tokens ride only on run kinds, both or neither", () => {
  const { weekToken, monthToken, ...bare } = pulse;
  assert.equal(PulseDocumentV1.safeParse(bare).success, true);
  assert.equal(PulseDocumentV1.safeParse({ ...bare, kind: "nag.shown" }).success, true);
  assert.equal(PulseDocumentV1.safeParse({ ...bare, kind: "nag.shown", weekToken, monthToken }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...bare, weekToken }).success, false);
  assert.equal(PulseDocumentV1.safeParse({ ...bare, monthToken }).success, false);
  // 0.2.0's stable token is gone.
  assert.equal(PulseDocumentV1.safeParse({ ...bare, programToken: "abcdefghijklmnop" }).success, false);
});

test("program tokens are 22 to 44 base64url characters", () => {
  for (const [token, ok] of [
    ["a".repeat(21), false],
    ["a".repeat(22), true],
    ["A-_9".repeat(11), true],
    ["a".repeat(45), false],
    ["a".repeat(31) + "=", false],
    ["a".repeat(31) + "/", false],
  ]) {
    assert.equal(PulseDocumentV1.safeParse({ ...pulse, weekToken: token }).success, ok, token);
    assert.equal(SignalDocumentV1.safeParse(docWith([{ ...programWith([]), stages: [stageOf()], monthToken: token }])).success, ok, token);
  }
});

test("the token rule's periods are the UTC ISO week and UTC month", () => {
  assert.deepEqual(programPeriods(new Date("2026-10-26T10:00:00Z")), { week: "2026-W44", month: "2026-10" });
  // Sunday is the last day of its ISO week.
  assert.deepEqual(programPeriods(new Date("2026-11-01T23:59:59Z")), { week: "2026-W44", month: "2026-11" });
  // UTC, not local: 9 am in Sydney on 1 November is still 31 October in UTC.
  assert.deepEqual(programPeriods(new Date("2026-11-01T09:00:00+11:00")), { week: "2026-W44", month: "2026-10" });
  // Week-numbering years: 1 January 2027 is a Friday, in 2026-W53; 4 January 2027 opens 2027-W01.
  assert.deepEqual(programPeriods(new Date("2027-01-01T00:00:00Z")), { week: "2026-W53", month: "2027-01" });
  assert.deepEqual(programPeriods(new Date("2027-01-04T00:00:00Z")), { week: "2027-W01", month: "2027-01" });
  // 29 December 2025 is a Monday in 2026-W01.
  assert.deepEqual(programPeriods(new Date("2025-12-29T00:00:00Z")), { week: "2026-W01", month: "2025-12" });
});

test("key and pulse requests", () => {
  const key = { challenge: "A".repeat(43), keyId: KEY_ID, attestation: "AAAA", context: { region: "AU", timeZone: "Australia/Sydney" } };
  assert.equal(SignalKeyRequest.safeParse(key).success, true);
  // 0.3.0: the context is required, both fields, strict, with the document context's shapes.
  const { context, ...noContext } = key;
  assert.equal(SignalKeyRequest.safeParse(noContext).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, context: { region: "AU" } }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, context: { timeZone: "UTC" } }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, context: { ...context, language: "en-AU" } }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, context: { ...context, region: "au" } }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, context: { ...context, timeZone: "Australia/Syd\u0000" } }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, keyId: "short" }).success, false);
  assert.equal(SignalKeyRequest.safeParse({ ...key, document: "{}" }).success, false);
  const p = { challenge: "A".repeat(43), keyId: KEY_ID, assertion: "AAAA", document: JSON.stringify(pulse) };
  assert.equal(SignalPulseRequest.safeParse(p).success, true);
  assert.equal(SignalPulseRequest.safeParse({ ...p, document: "x".repeat(4097) }).success, false);
  // The 0.1 program upload's attestation field is gone.
  assert.equal(
    SignalUploadRequest.safeParse({ platform: "ios", challenge: "A".repeat(43), keyId: KEY_ID, attestation: "AAAA", document: "{}" }).success,
    false,
  );
});

test("the new error codes are on both lists", () => {
  for (const code of ["ASSERTION_INVALID", "KEY_UNKNOWN", "KEY_EXPIRED", "COUNTER_REPLAY", "KEY_QUOTA"]) {
    assert.ok(Object.values(ErrorCode).includes(code), code);
    assert.ok(Object.values(SignalErrorCode).includes(code), code);
  }
  assert.equal(SIGNAL_KEY_DAILY_UPLOADS, 200);
});

const routineItem = (n, blocks = 1) => ({
  name: `item ${n}`,
  kind: "timed",
  cadence: { kind: "daily" },
  ...(blocks > 0 ? { routine: { blocks: Array.from({ length: blocks }, () => ({ kind: "rest", seconds: 5 })) } } : {}),
});

const stageOf = () => ({ name: "Stage", exit: { kind: "manual" }, items: [] });

const programWith = (stages) => ({
  weekToken: "W".repeat(32),
  monthToken: "M".repeat(32),
  name: "Hand",
  kind: "rehab",
  source: "hand",
  ageWeeks: 1,
  keptAt: { d7: true, d30: false, d90: false },
  stages,
});

const docWith = (programs) => ({ ...doc, programs });

test("a program carries both rotating tokens and no stable one", () => {
  const p = programWith([stageOf()]);
  assert.equal(SignalDocumentV1.safeParse(docWith([p])).success, true);
  const { weekToken, monthToken, ...bare } = p;
  assert.equal(SignalDocumentV1.safeParse(docWith([{ ...bare, monthToken }])).success, false);
  assert.equal(SignalDocumentV1.safeParse(docWith([{ ...bare, weekToken }])).success, false);
  assert.equal(SignalDocumentV1.safeParse(docWith([{ ...p, token: "abcdefghijklmnop" }])).success, false);
});

test("control characters are refused in every string field", () => {
  for (const bad of ["a\u0000b", "a\u0007b", "a\u001fb", "a\u007fb"]) {
    assert.equal(SignalDocumentV1.safeParse(docWith([programWith([{ name: bad, exit: { kind: "manual" }, items: [] }])])).success, false);
    assert.equal(SignalDocumentV1.safeParse({ ...doc, context: { ...doc.context, appBuild: bad } }).success, false);
  }
  assert.equal(hasNoControlCharacters("Wrist circles, left"), true);
  assert.equal(hasNoControlCharacters("tab\there"), false);
  const upload = {
    platform: "ios",
    challenge: "A".repeat(43),
    keyId: KEY_ID,
    assertion: "AAAA",
    document: "{\n  \"version\": 1\n}",
  };
  assert.equal(SignalUploadRequest.safeParse({ ...upload, assertion: "AA\u0001A" }).success, false);
  // The document text may hold JSON whitespace; its parsed strings are checked by the document schema.
  assert.equal(SignalUploadRequest.safeParse(upload).success, true);
});

test("the whole document holds at most 400 items", () => {
  const stage = (count) => ({ name: "Stage", exit: { kind: "manual" }, items: Array.from({ length: count }, (_, i) => routineItem(i, 0)) });
  // 20 programs x 1 stage x 20 items = 400: allowed.
  const ok = Array.from({ length: 20 }, () => programWith([stage(20)]));
  assert.equal(SignalDocumentV1.safeParse(docWith(ok)).success, true);
  // 401 items: refused, though every per-array cap holds.
  const over = [...ok.slice(0, 19), programWith([stage(20), stage(1)])];
  assert.equal(SignalDocumentV1.safeParse(docWith(over)).success, false);
  assert.equal(MAX_DOCUMENT_ITEMS, 400);
});

test("the whole document holds at most 2,000 routine blocks", () => {
  // 20 programs x 4 items x 25 blocks = 2,000: allowed.
  const stage = { name: "Stage", exit: { kind: "manual" }, items: Array.from({ length: 4 }, (_, i) => routineItem(i, 25)) };
  const ok = Array.from({ length: 20 }, () => programWith([stage]));
  assert.equal(SignalDocumentV1.safeParse(docWith(ok)).success, true);
  const extra = { name: "Stage", exit: { kind: "manual" }, items: [routineItem(9, 1)] };
  const over = [...ok.slice(0, 19), programWith([stage, extra])];
  assert.equal(SignalDocumentV1.safeParse(docWith(over)).success, false);
  assert.equal(MAX_DOCUMENT_ROUTINE_BLOCKS, 2000);
});

test("the program token rule's test vector, as documented at the top of signals.ts", () => {
  const derive = (secret, programId, period) =>
    createHash("sha256")
      .update(Buffer.concat([secret, Buffer.from(programId, "utf8"), Buffer.from(period, "ascii")]))
      .digest("base64url")
      .slice(0, 32);
  const secret = Buffer.alloc(32, 1);
  const id = "3F2504E0-4F89-41D3-9D0A-0305E82C3301";
  const { week, month } = programPeriods(new Date("2026-10-26T10:00:00Z"));
  const weekToken = derive(secret, id, week);
  const monthToken = derive(secret, id, month);
  assert.equal(weekToken, "zhmS2alIKLI4o5p_Z44tR51pOwfp-XSz");
  assert.equal(monthToken, "Z5hW5C_oDizW5aXx6fhkIVN7gOVGS2Xn");
  assert.equal(PulseDocumentV1.safeParse({ ...pulse, weekToken, monthToken }).success, true);
});
