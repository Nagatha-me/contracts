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
    // Signals (pre-auth REST, see `signals.ts`). Each is a 400 except NOT_YET (501).
    ChallengeInvalid: "CHALLENGE_INVALID",
    DocumentInvalid: "DOCUMENT_INVALID",
    AttestationInvalid: "ATTESTATION_INVALID",
    NotYet: "NOT_YET",
};
//# sourceMappingURL=errors.js.map