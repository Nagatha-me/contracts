/**
 * REST shapes around sign-in. Sign-in itself is better-auth at `/auth/*`
 * (email code and passkey); these are the routes Nagatha adds beside it.
 */
import { z } from "zod";
/** `POST /admin/claim` (session cookie): turn the signed-in account into a super admin. */
export const SuperAdminClaimRequest = z.strictObject({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
//# sourceMappingURL=auth.js.map