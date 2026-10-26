/**
 * RPC over the socket: `socket.emit("RPC", request, ack)`. The ack always
 * receives an `RpcResponse`. One user intent is one RPC; the client never
 * sequences calls for a single intent.
 */

import { z } from "zod";

import type { WireError } from "./errors.js";

export interface RpcRequest<M extends string = string, I = unknown> {
  method: M;
  input: I;
  /** Optional client correlation id, echoed nowhere but useful in client logs. */
  requestId?: string;
}

export type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: WireError };

export const RpcMethod = {
  Ping: "ping",
  AdminWhoami: "admin.whoami",
} as const;

export type RpcMethod = (typeof RpcMethod)[keyof typeof RpcMethod];

export const PingInput = z.strictObject({ note: z.string().min(1).max(200).optional() });
export type PingInput = z.infer<typeof PingInput>;
export interface PingOutput {
  pong: string;
  ts: number;
  userId: string;
}

export const AdminWhoamiInput = z.strictObject({});
export type AdminWhoamiInput = z.infer<typeof AdminWhoamiInput>;
export interface AdminWhoamiOutput {
  userId: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
}

/** Method name to input and output, for a typed client wrapper. */
export interface RpcMethods {
  ping: { input: PingInput; output: PingOutput };
  "admin.whoami": { input: AdminWhoamiInput; output: AdminWhoamiOutput };
}
