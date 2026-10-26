/**
 * Anonymous usage signals (design section 8). Two pre-auth REST routes, no
 * cookie, no bearer:
 *
 *   GET  /signals/challenge -> SignalChallengeResponse
 *   POST /signals           SignalUploadRequest -> SignalUploadResponse
 *
 * The phone scrubs the document before it leaves (three layers, on device).
 * This schema is the server's second line: strict keys, bounded arrays, a cap
 * on the whole document's items and routine blocks, every name capped at 60
 * characters, no control characters in any string, every number in a
 * plausible range.
 */
import { z } from "zod";
export declare const SIGNAL_CHALLENGE_TTL_SECONDS = 120;
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
export declare const SignalUploadRequest: z.ZodObject<{
    platform: z.ZodEnum<{
        ios: "ios";
        android: "android";
    }>;
    challenge: z.ZodString;
    keyId: z.ZodString;
    attestation: z.ZodString;
    document: z.ZodString;
}, z.core.$strict>;
export type SignalUploadRequest = z.infer<typeof SignalUploadRequest>;
/** `POST /signals` success. Failures are a `RestErrorBody` with a code below. */
export interface SignalUploadResponse {
    accepted: true;
}
/** The codes `POST /signals` may answer with, beside RATE_LIMITED (429). */
export declare const SignalErrorCode: {
    readonly Invalid: "INVALID";
    readonly ChallengeInvalid: "CHALLENGE_INVALID";
    readonly DocumentInvalid: "DOCUMENT_INVALID";
    readonly AttestationInvalid: "ATTESTATION_INVALID";
    readonly NotYet: "NOT_YET";
};
export type SignalErrorCode = (typeof SignalErrorCode)[keyof typeof SignalErrorCode];
//# sourceMappingURL=signals.d.ts.map