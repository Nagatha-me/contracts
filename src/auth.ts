/**
 * REST shapes around sign-in. Sign-in itself is better-auth at `/auth/*`
 * (email code and passkey); these are the routes Nagatha adds beside it.
 */

import { z } from "zod";

/** `GET /auth/socket-token` (session cookie): a 24 hour socket JWT. */
export interface SocketTokenResponse {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

/** `POST /admin/claim` (session cookie): turn the signed-in account into a super admin. */
export const SuperAdminClaimRequest = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type SuperAdminClaimRequest = z.infer<typeof SuperAdminClaimRequest>;

export interface SuperAdminClaimResponse {
  ok: true;
}
