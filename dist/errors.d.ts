/**
 * Stable error codes used across the wire: the RPC ack's `error.code`, the
 * REST error body's `code`, and the socket handshake refusal message.
 *
 * Adding a code is a minor release. Renaming or removing one is MAJOR (see the
 * SemVer note in `index.ts`).
 */
export declare const ErrorCode: {
    readonly Unauthenticated: "UNAUTHENTICATED";
    readonly Forbidden: "FORBIDDEN";
    readonly NotFound: "NOT_FOUND";
    readonly Invalid: "INVALID";
    readonly Conflict: "CONFLICT";
    readonly RateLimited: "RATE_LIMITED";
    readonly NotImplemented: "NOT_IMPLEMENTED";
    readonly Internal: "INTERNAL";
    readonly ChallengeInvalid: "CHALLENGE_INVALID";
    readonly DocumentInvalid: "DOCUMENT_INVALID";
    readonly AttestationInvalid: "ATTESTATION_INVALID";
    readonly AssertionInvalid: "ASSERTION_INVALID";
    readonly KeyUnknown: "KEY_UNKNOWN";
    readonly KeyExpired: "KEY_EXPIRED";
    readonly CounterReplay: "COUNTER_REPLAY";
    readonly KeyQuota: "KEY_QUOTA";
    readonly NotYet: "NOT_YET";
};
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
/** The error half of an RPC ack, and the core of every REST error body. */
export interface WireError {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
}
/**
 * The REST error body. `statusCode` and `error` (the HTTP status text) keep
 * Fastify's own envelope readable; `code`, `message` and `details` are the
 * `WireError`.
 */
export interface RestErrorBody extends WireError {
    statusCode: number;
    error: string;
}
//# sourceMappingURL=errors.d.ts.map