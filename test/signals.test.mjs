import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DOCUMENT_ITEMS,
  MAX_DOCUMENT_ROUTINE_BLOCKS,
  SignalDocumentV1,
  SignalUploadRequest,
  hasNoControlCharacters,
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

const routineItem = (n, blocks = 1) => ({
  name: `item ${n}`,
  kind: "timed",
  cadence: { kind: "daily" },
  ...(blocks > 0 ? { routine: { blocks: Array.from({ length: blocks }, () => ({ kind: "rest", seconds: 5 })) } } : {}),
});

const programWith = (stages) => ({
  token: "abcdefghijklmnop",
  name: "Hand",
  kind: "rehab",
  source: "hand",
  ageWeeks: 1,
  keptAt: { d7: true, d30: false, d90: false },
  stages,
});

const docWith = (programs) => ({ ...doc, programs });

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
    keyId: "key\u0001id",
    attestation: "AAAA",
    document: "{\n  \"version\": 1\n}",
  };
  assert.equal(SignalUploadRequest.safeParse(upload).success, false);
  // The document text may hold JSON whitespace; its parsed strings are checked by the document schema.
  assert.equal(SignalUploadRequest.safeParse({ ...upload, keyId: "keyid" }).success, true);
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
