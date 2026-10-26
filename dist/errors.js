/**
 * Stable error codes used across the wire: the RPC ack's `error.code`, the
 * REST error body's `code`, and the socket handshake refusal message.
 *
 * Adding a code is a minor release. Renaming or removing one is MAJOR (see the
 * SemVer note in `index.ts`).
 */
export const ErrorCode = {
    Unauthenticated: "UNAUTHENTICATED",
    Forbidden: "FORBIDDEN",
    NotFound: "NOT_FOUND",
    Invalid: "INVALID",
    Conflict: "CONFLICT",
    RateLimited: "RATE_LIMITED",
    NotImplemented: "NOT_IMPLEMENTED",
    Internal: "INTERNAL",
    // Signals (pre-auth REST, see `signals.ts` for each code's HTTP status).
    ChallengeInvalid: "CHALLENGE_INVALID",
    DocumentInvalid: "DOCUMENT_INVALID",
    AttestationInvalid: "ATTESTATION_INVALID",
    AssertionInvalid: "ASSERTION_INVALID",
    KeyUnknown: "KEY_UNKNOWN",
    KeyExpired: "KEY_EXPIRED",
    CounterReplay: "COUNTER_REPLAY",
    KeyQuota: "KEY_QUOTA",
    NotYet: "NOT_YET",
};
//# sourceMappingURL=errors.js.map