/**
 * RPC over the socket: `socket.emit("RPC", request, ack)`. The ack always
 * receives an `RpcResponse`. One user intent is one RPC; the client never
 * sequences calls for a single intent.
 */
import { z } from "zod";
export const RpcMethod = {
    Ping: "ping",
    AdminWhoami: "admin.whoami",
};
export const PingInput = z.strictObject({ note: z.string().min(1).max(200).optional() });
export const AdminWhoamiInput = z.strictObject({});
//# sourceMappingURL=rpc.js.map