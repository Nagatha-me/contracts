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
 * calendar month. The server keeps only sha256 of each token, with its period
 * and the region it was first seen in, and deletes it two periods later.
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
 * Error codes (beside 429 RATE_LIMITED from the per-IP limiter): INVALID,
 * CHALLENGE_INVALID, DOCUMENT_INVALID, ATTESTATION_INVALID, ASSERTION_INVALID
 * (each 400), KEY_UNKNOWN (404), KEY_EXPIRED (410), COUNTER_REPLAY (409),
 * CONFLICT (409, key already attested), KEY_QUOTA (429), NOT_YET (501, Android).
 */
import { z } from "zod";
export declare const SIGNAL_CHALLENGE_TTL_SECONDS = 120;
/** A day key lives this long after its attestation. */
export declare const SIGNAL_KEY_TTL_SECONDS: number;
/** Uploads (pulses and program documents together) one day key may sign. */
export declare const SIGNAL_KEY_DAILY_UPLOADS = 200;
/** The most events of one kind a pulse may coalesce (one minute's worth). */
export declare const PULSE_COUNT_MAX = 60;
export declare const SIGNAL_NAME_MAX = 60;
/** Across the whole document: items in every stage of every program. */
export declare const MAX_DOCUMENT_ITEMS = 400;
/** Across the whole document: routine blocks, counting those inside groups. */
export declare const MAX_DOCUMENT_ROUTINE_BLOCKS = 2000;
/** The program token periods for an instant, both in UTC (see "Program tokens" at the top). */
export interface ProgramPeriods {
    /** ISO 8601 week, `YYYY-Www`, for example `2026-W44`. */
    week: string;
    /** Calendar month, `YYYY-MM`, for example `2026-10`. */
    month: string;
}
/** The UTC ISO week and UTC month of `at`, as the program tokens use them. */
export declare function programPeriods(at: Date): ProgramPeriods;
/** True when `s` holds no C0 control character (U+0000 to U+001F) and no DEL (U+007F). */
export declare function hasNoControlCharacters(s: string): boolean;
export declare const SignalContext: z.ZodObject<{
    appBuild: z.ZodString;
    osMajor: z.ZodNumber;
    deviceClass: z.ZodString;
    language: z.ZodString;
    region: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strict>;
export type SignalContext = z.infer<typeof SignalContext>;
export declare const ItemKind: z.ZodEnum<{
    timed: "timed";
    count: "count";
    tick: "tick";
    checkIn: "checkIn";
    abstain: "abstain";
}>;
export type ItemKind = z.infer<typeof ItemKind>;
export declare const CadenceKind: z.ZodEnum<{
    spread: "spread";
    fixed: "fixed";
    weekdays: "weekdays";
    weekly: "weekly";
    deadline: "deadline";
    daily: "daily";
}>;
export declare const SignalCadence: z.ZodObject<{
    kind: z.ZodEnum<{
        spread: "spread";
        fixed: "fixed";
        weekdays: "weekdays";
        weekly: "weekly";
        deadline: "deadline";
        daily: "daily";
    }>;
    timesPerDay: z.ZodOptional<z.ZodNumber>;
    fixedTimes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    weekdayCount: z.ZodOptional<z.ZodNumber>;
    deadlineLeadDays: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const RoutineBlock: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"step">;
    words: z.ZodString;
    seconds: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"move">;
    words: z.ZodString;
    count: z.ZodNumber;
    seconds: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"rest">;
    seconds: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"group">;
    repeat: z.ZodNumber;
    switchSides: z.ZodBoolean;
    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"step">;
        words: z.ZodString;
        seconds: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"move">;
        words: z.ZodString;
        count: z.ZodNumber;
        seconds: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"rest">;
        seconds: z.ZodNumber;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>], "kind">;
export type RoutineBlock = z.infer<typeof RoutineBlock>;
export declare const MAX_ROUTINE_BLOCKS = 30;
export declare const SignalRoutine: z.ZodObject<{
    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"step">;
        words: z.ZodString;
        seconds: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"move">;
        words: z.ZodString;
        count: z.ZodNumber;
        seconds: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"rest">;
        seconds: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"group">;
        repeat: z.ZodNumber;
        switchSides: z.ZodBoolean;
        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"step">;
            words: z.ZodString;
            seconds: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            words: z.ZodString;
            count: z.ZodNumber;
            seconds: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"rest">;
            seconds: z.ZodNumber;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export declare const SignalItem: z.ZodObject<{
    name: z.ZodString;
    kind: z.ZodEnum<{
        timed: "timed";
        count: "count";
        tick: "tick";
        checkIn: "checkIn";
        abstain: "abstain";
    }>;
    cadence: z.ZodObject<{
        kind: z.ZodEnum<{
            spread: "spread";
            fixed: "fixed";
            weekdays: "weekdays";
            weekly: "weekly";
            deadline: "deadline";
            daily: "daily";
        }>;
        timesPerDay: z.ZodOptional<z.ZodNumber>;
        fixedTimes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        weekdayCount: z.ZodOptional<z.ZodNumber>;
        deadlineLeadDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    routine: z.ZodOptional<z.ZodObject<{
        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"step">;
            words: z.ZodString;
            seconds: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"move">;
            words: z.ZodString;
            count: z.ZodNumber;
            seconds: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"rest">;
            seconds: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"group">;
            repeat: z.ZodNumber;
            switchSides: z.ZodBoolean;
            blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"step">;
                words: z.ZodString;
                seconds: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                words: z.ZodString;
                count: z.ZodNumber;
                seconds: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"rest">;
                seconds: z.ZodNumber;
            }, z.core.$strict>], "kind">>;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SignalItem = z.infer<typeof SignalItem>;
export declare const StageExitKind: z.ZodEnum<{
    date: "date";
    doneCount: "doneCount";
    streak: "streak";
    checkpoint: "checkpoint";
    manual: "manual";
}>;
export declare const SignalStage: z.ZodObject<{
    name: z.ZodString;
    exit: z.ZodObject<{
        kind: z.ZodEnum<{
            date: "date";
            doneCount: "doneCount";
            streak: "streak";
            checkpoint: "checkpoint";
            manual: "manual";
        }>;
        n: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    items: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        kind: z.ZodEnum<{
            timed: "timed";
            count: "count";
            tick: "tick";
            checkIn: "checkIn";
            abstain: "abstain";
        }>;
        cadence: z.ZodObject<{
            kind: z.ZodEnum<{
                spread: "spread";
                fixed: "fixed";
                weekdays: "weekdays";
                weekly: "weekly";
                deadline: "deadline";
                daily: "daily";
            }>;
            timesPerDay: z.ZodOptional<z.ZodNumber>;
            fixedTimes: z.ZodOptional<z.ZodArray<z.ZodString>>;
            weekdayCount: z.ZodOptional<z.ZodNumber>;
            deadlineLeadDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        routine: z.ZodOptional<z.ZodObject<{
            blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"step">;
                words: z.ZodString;
                seconds: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"move">;
                words: z.ZodString;
                count: z.ZodNumber;
                seconds: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"rest">;
                seconds: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"group">;
                repeat: z.ZodNumber;
                switchSides: z.ZodBoolean;
                blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"step">;
                    words: z.ZodString;
                    seconds: z.ZodNumber;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"move">;
                    words: z.ZodString;
                    count: z.ZodNumber;
                    seconds: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"rest">;
                    seconds: z.ZodNumber;
                }, z.core.$strict>], "kind">>;
            }, z.core.$strict>], "kind">>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ProgramKind: z.ZodEnum<{
    custom: "custom";
    routine: "routine";
    rehab: "rehab";
    habit: "habit";
    project: "project";
    quit: "quit";
}>;
export declare const ProgramSource: z.ZodEnum<{
    hand: "hand";
    template: "template";
    onboarding: "onboarding";
    reminders: "reminders";
    sheet: "sheet";
}>;
export declare const SignalProgram: z.ZodObject<{
    weekToken: z.ZodString;
    monthToken: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        custom: "custom";
        routine: "routine";
        rehab: "rehab";
        habit: "habit";
        project: "project";
        quit: "quit";
    }>;
    source: z.ZodEnum<{
        hand: "hand";
        template: "template";
        onboarding: "onboarding";
        reminders: "reminders";
        sheet: "sheet";
    }>;
    templateId: z.ZodOptional<z.ZodString>;
    ageWeeks: z.ZodNumber;
    keptAt: z.ZodObject<{
        d7: z.ZodBoolean;
        d30: z.ZodBoolean;
        d90: z.ZodBoolean;
    }, z.core.$strict>;
    stages: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        exit: z.ZodObject<{
            kind: z.ZodEnum<{
                date: "date";
                doneCount: "doneCount";
                streak: "streak";
                checkpoint: "checkpoint";
                manual: "manual";
            }>;
            n: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        items: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            kind: z.ZodEnum<{
                timed: "timed";
                count: "count";
                tick: "tick";
                checkIn: "checkIn";
                abstain: "abstain";
            }>;
            cadence: z.ZodObject<{
                kind: z.ZodEnum<{
                    spread: "spread";
                    fixed: "fixed";
                    weekdays: "weekdays";
                    weekly: "weekly";
                    deadline: "deadline";
                    daily: "daily";
                }>;
                timesPerDay: z.ZodOptional<z.ZodNumber>;
                fixedTimes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                weekdayCount: z.ZodOptional<z.ZodNumber>;
                deadlineLeadDays: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>;
            routine: z.ZodOptional<z.ZodObject<{
                blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"step">;
                    words: z.ZodString;
                    seconds: z.ZodNumber;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"move">;
                    words: z.ZodString;
                    count: z.ZodNumber;
                    seconds: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"rest">;
                    seconds: z.ZodNumber;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"group">;
                    repeat: z.ZodNumber;
                    switchSides: z.ZodBoolean;
                    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        kind: z.ZodLiteral<"step">;
                        words: z.ZodString;
                        seconds: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        kind: z.ZodLiteral<"move">;
                        words: z.ZodString;
                        count: z.ZodNumber;
                        seconds: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>, z.ZodObject<{
                        kind: z.ZodLiteral<"rest">;
                        seconds: z.ZodNumber;
                    }, z.core.$strict>], "kind">>;
                }, z.core.$strict>], "kind">>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SignalProgram = z.infer<typeof SignalProgram>;
export declare const SignalEventCounts: z.ZodObject<{
    nagsShown: z.ZodNumber;
    nagsCompleted: z.ZodNumber;
    runsStarted: z.ZodNumber;
    runsFinished: z.ZodNumber;
    snoozes: z.ZodNumber;
    skips: z.ZodNumber;
    shares: z.ZodNumber;
    laughs: z.ZodNumber;
    lineGenerations: z.ZodNumber;
}, z.core.$strict>;
export type SignalEventCounts = z.infer<typeof SignalEventCounts>;
export declare const SignalEvents: z.ZodObject<{
    weekStart: z.ZodString;
    counts: z.ZodObject<{
        nagsShown: z.ZodNumber;
        nagsCompleted: z.ZodNumber;
        runsStarted: z.ZodNumber;
        runsFinished: z.ZodNumber;
        snoozes: z.ZodNumber;
        skips: z.ZodNumber;
        shares: z.ZodNumber;
        laughs: z.ZodNumber;
        lineGenerations: z.ZodNumber;
    }, z.core.$strict>;
    hourOfDay: z.ZodArray<z.ZodNumber>;
    weekday: z.ZodArray<z.ZodNumber>;
}, z.core.$strict>;
export declare const SignalDocumentV1: z.ZodObject<{
    version: z.ZodLiteral<1>;
    context: z.ZodObject<{
        appBuild: z.ZodString;
        osMajor: z.ZodNumber;
        deviceClass: z.ZodString;
        language: z.ZodString;
        region: z.ZodString;
        timeZone: z.ZodString;
    }, z.core.$strict>;
    programs: z.ZodArray<z.ZodObject<{
        weekToken: z.ZodString;
        monthToken: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            custom: "custom";
            routine: "routine";
            rehab: "rehab";
            habit: "habit";
            project: "project";
            quit: "quit";
        }>;
        source: z.ZodEnum<{
            hand: "hand";
            template: "template";
            onboarding: "onboarding";
            reminders: "reminders";
            sheet: "sheet";
        }>;
        templateId: z.ZodOptional<z.ZodString>;
        ageWeeks: z.ZodNumber;
        keptAt: z.ZodObject<{
            d7: z.ZodBoolean;
            d30: z.ZodBoolean;
            d90: z.ZodBoolean;
        }, z.core.$strict>;
        stages: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            exit: z.ZodObject<{
                kind: z.ZodEnum<{
                    date: "date";
                    doneCount: "doneCount";
                    streak: "streak";
                    checkpoint: "checkpoint";
                    manual: "manual";
                }>;
                n: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>;
            items: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                kind: z.ZodEnum<{
                    timed: "timed";
                    count: "count";
                    tick: "tick";
                    checkIn: "checkIn";
                    abstain: "abstain";
                }>;
                cadence: z.ZodObject<{
                    kind: z.ZodEnum<{
                        spread: "spread";
                        fixed: "fixed";
                        weekdays: "weekdays";
                        weekly: "weekly";
                        deadline: "deadline";
                        daily: "daily";
                    }>;
                    timesPerDay: z.ZodOptional<z.ZodNumber>;
                    fixedTimes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    weekdayCount: z.ZodOptional<z.ZodNumber>;
                    deadlineLeadDays: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>;
                routine: z.ZodOptional<z.ZodObject<{
                    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        kind: z.ZodLiteral<"step">;
                        words: z.ZodString;
                        seconds: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        kind: z.ZodLiteral<"move">;
                        words: z.ZodString;
                        count: z.ZodNumber;
                        seconds: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>, z.ZodObject<{
                        kind: z.ZodLiteral<"rest">;
                        seconds: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        kind: z.ZodLiteral<"group">;
                        repeat: z.ZodNumber;
                        switchSides: z.ZodBoolean;
                        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            kind: z.ZodLiteral<"step">;
                            words: z.ZodString;
                            seconds: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            kind: z.ZodLiteral<"move">;
                            words: z.ZodString;
                            count: z.ZodNumber;
                            seconds: z.ZodOptional<z.ZodNumber>;
                        }, z.core.$strict>, z.ZodObject<{
                            kind: z.ZodLiteral<"rest">;
                            seconds: z.ZodNumber;
                        }, z.core.$strict>], "kind">>;
                    }, z.core.$strict>], "kind">>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    events: z.ZodObject<{
        weekStart: z.ZodString;
        counts: z.ZodObject<{
            nagsShown: z.ZodNumber;
            nagsCompleted: z.ZodNumber;
            runsStarted: z.ZodNumber;
            runsFinished: z.ZodNumber;
            snoozes: z.ZodNumber;
            skips: z.ZodNumber;
            shares: z.ZodNumber;
            laughs: z.ZodNumber;
            lineGenerations: z.ZodNumber;
        }, z.core.$strict>;
        hourOfDay: z.ZodArray<z.ZodNumber>;
        weekday: z.ZodArray<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type SignalDocumentV1 = z.infer<typeof SignalDocumentV1>;
/** The event kinds a pulse may carry. `run.*` kinds may carry the program tokens. */
export declare const PulseKind: z.ZodEnum<{
    "run.finished": "run.finished";
    "run.started": "run.started";
    "nag.shown": "nag.shown";
    "nag.completed": "nag.completed";
    "nag.snoozed": "nag.snoozed";
    "nag.skipped": "nag.skipped";
    "line.shared": "line.shared";
    "line.laughed": "line.laughed";
}>;
export type PulseKind = z.infer<typeof PulseKind>;
export declare const PulseDocumentV1: z.ZodObject<{
    version: z.ZodLiteral<1>;
    kind: z.ZodEnum<{
        "run.finished": "run.finished";
        "run.started": "run.started";
        "nag.shown": "nag.shown";
        "nag.completed": "nag.completed";
        "nag.snoozed": "nag.snoozed";
        "nag.skipped": "nag.skipped";
        "line.shared": "line.shared";
        "line.laughed": "line.laughed";
    }>;
    at: z.ZodObject<{
        hour: z.ZodNumber;
        weekday: z.ZodNumber;
    }, z.core.$strict>;
    context: z.ZodObject<{
        appBuild: z.ZodString;
        osMajor: z.ZodNumber;
        deviceClass: z.ZodString;
        language: z.ZodString;
        region: z.ZodString;
        timeZone: z.ZodString;
    }, z.core.$strict>;
    weekToken: z.ZodOptional<z.ZodString>;
    monthToken: z.ZodOptional<z.ZodString>;
    count: z.ZodNumber;
}, z.core.$strict>;
export type PulseDocumentV1 = z.infer<typeof PulseDocumentV1>;
/** `GET /signals/challenge` response. */
export interface SignalChallengeResponse {
    /** base64url of 32 random bytes. Single use: one challenge per key, pulse or document. */
    challenge: string;
    expiresInSeconds: typeof SIGNAL_CHALLENGE_TTL_SECONDS;
}
/** The cap on `gapDays`: 30 means 30 days or more since the phone was last counted. */
export declare const SIGNAL_GAP_DAYS_MAX = 30;
/**
 * `SignalKeyRequest.context` (0.4.0): the full `SignalContext` plus `gapDays`,
 * an integer 1 to 30 (days since this phone was last counted active, capped
 * at 30) or `null` (never counted before). Strict.
 */
export declare const SignalKeyContext: z.ZodObject<{
    gapDays: z.ZodNullable<z.ZodNumber>;
    appBuild: z.ZodString;
    osMajor: z.ZodNumber;
    deviceClass: z.ZodString;
    language: z.ZodString;
    region: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strict>;
export type SignalKeyContext = z.infer<typeof SignalKeyContext>;
/**
 * The phone's `gapDays` for a first attestation on UTC day `today`, from the
 * UTC day of its last accepted attestation (see "The phone's rules" at the
 * top). Both days are `YYYY-MM-DD`. `null` for no history or a history in the
 * future; otherwise the whole days between, capped at 30. Throws when the two
 * days are equal: a second attestation the same day resends the day's first
 * gap and never calls this.
 */
export declare function signalGapDays(lastActiveDay: string | null, today: string): number | null;
/**
 * `POST /signals/key` body: attest today's key. The attestation's
 * clientDataHash is `sha256(challengeBytes)`; no document is bound.
 * `context` (0.4.0, required) is the full context plus `gapDays`; it counts
 * the phone in the daily, hourly and rolling active counts, and nowhere else.
 */
export declare const SignalKeyRequest: z.ZodObject<{
    challenge: z.ZodString;
    keyId: z.ZodString;
    attestation: z.ZodString;
    context: z.ZodObject<{
        gapDays: z.ZodNullable<z.ZodNumber>;
        appBuild: z.ZodString;
        osMajor: z.ZodNumber;
        deviceClass: z.ZodString;
        language: z.ZodString;
        region: z.ZodString;
        timeZone: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
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
export declare const SignalPulseRequest: z.ZodObject<{
    challenge: z.ZodString;
    keyId: z.ZodString;
    assertion: z.ZodString;
    document: z.ZodString;
}, z.core.$strict>;
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
export declare const SignalUploadRequest: z.ZodObject<{
    platform: z.ZodEnum<{
        ios: "ios";
        android: "android";
    }>;
    challenge: z.ZodString;
    keyId: z.ZodString;
    assertion: z.ZodString;
    document: z.ZodString;
}, z.core.$strict>;
export type SignalUploadRequest = z.infer<typeof SignalUploadRequest>;
/** `POST /signals` success. Failures are a `RestErrorBody` with a code below. */
export interface SignalUploadResponse {
    accepted: true;
}
/**
 * The codes the signal routes answer with, beside RATE_LIMITED (429) and
 * CONFLICT (409, a key id attested twice). HTTP status in brackets.
 */
export declare const SignalErrorCode: {
    /** [400] The body does not match the request schema. */
    readonly Invalid: "INVALID";
    /** [400] The challenge is unknown, used or expired. Fetch a new one. */
    readonly ChallengeInvalid: "CHALLENGE_INVALID";
    /** [400] The document is not JSON or fails its schema. */
    readonly DocumentInvalid: "DOCUMENT_INVALID";
    /** [400] `POST /signals/key`: the attestation failed verification. */
    readonly AttestationInvalid: "ATTESTATION_INVALID";
    /** [400] The assertion is not CBOR, the signature fails, or the app id differs. */
    readonly AssertionInvalid: "ASSERTION_INVALID";
    /** [404] No live key with this id. Attest a new key. */
    readonly KeyUnknown: "KEY_UNKNOWN";
    /** [410] The key's 24 hours are over. Attest a new key. */
    readonly KeyExpired: "KEY_EXPIRED";
    /** [409] The assertion's counter is not above the last one accepted. Drop the upload. */
    readonly CounterReplay: "COUNTER_REPLAY";
    /** [429] The key has signed its `SIGNAL_KEY_DAILY_UPLOADS`. Wait for the next key. */
    readonly KeyQuota: "KEY_QUOTA";
    /** [501] Android, until Play Integrity lands. */
    readonly NotYet: "NOT_YET";
};
export type SignalErrorCode = (typeof SignalErrorCode)[keyof typeof SignalErrorCode];
//# sourceMappingURL=signals.d.ts.map