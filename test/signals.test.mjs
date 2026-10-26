import { test } from "node:test";
import assert from "node:assert/strict";

import { SignalDocumentV1, verbOf, signalNameRollupId } from "../dist/index.js";

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
