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
    token: z.ZodString;
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
        token: z.ZodString;
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
/** The event kinds a pulse may carry. `run.*` kinds may carry a program token. */
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
    programToken: z.ZodOptional<z.ZodString>;
    count: z.ZodNumber;
}, z.core.$strict>;
export type PulseDocumentV1 = z.infer<typeof PulseDocumentV1>;
/** `GET /signals/challenge` response. */
export interface SignalChallengeResponse {
    /** base64url of 32 random bytes. Single use: one challenge per key, pulse or document. */
    challenge: string;
    expiresInSeconds: typeof SIGNAL_CHALLENGE_TTL_SECONDS;
}
/**
 * `POST /signals/key` body: attest today's key. The attestation's
 * clientDataHash is `sha256(challengeBytes)`; no document is bound.
 */
export declare const SignalKeyRequest: z.ZodObject<{
    challenge: z.ZodString;
    keyId: z.ZodString;
    attestation: z.ZodString;
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