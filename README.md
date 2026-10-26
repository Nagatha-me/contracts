# @nagatha/contracts

The wire contract between the Nagatha server, the web portal and, later, the
apps: socket event names and payloads, sync row types, RPC methods, the REST
request and response shapes, the signal document schema, and the error codes.
ESM, TypeScript, `zod` 4 as the only dependency.

## What is in it

| File | Contents |
|---|---|
| `src/events.ts` | `SocketEventName` (`SYNC_DATA`, `SYNC_COMPLETE`, `DIFF_SYNC`, `SYNC_RESET`, `SOCKET_EVENT`, `RPC`), the handshake `{ token, cursor? }`, every payload, `EventType`, `verbOf` |
| `src/rows.ts` | `SyncType` and the row types `UserRow`, `SignalRollupRow`, `SignalNameRollupRow`, plus the rollup id builders |
| `src/rpc.ts` | `RpcRequest`, `RpcResponse`, `RpcMethod` (`ping`, `admin.whoami`) with inputs and outputs |
| `src/auth.ts` | `GET /auth/socket-token` response, `POST /admin/claim` request and response |
| `src/signals.ts` | `SignalDocumentV1` (zod), `GET /signals/challenge` and `POST /signals` shapes, `SignalErrorCode` |
| `src/errors.ts` | `ErrorCode`, `WireError`, `RestErrorBody` |

## Versioning

SemVer, released with `npm run release` (`scripts/release.mjs`, the same tool
nutmegs uses): it commits pending work, rebuilds `dist/`, bumps the version and
pushes an annotated `vX.Y.Z` tag.

- Additive optional fields, new event names, error codes or RPC methods: minor.
- Renames, type changes, new required fields, removals: major, shipped in two
  steps (server accepts both shapes, clients move, the old shape goes).
- Comment and documentation fixes: patch.

## Consuming it

Consumers pin a tag: `"@nagatha/contracts": "github:<org>/nagatha-contracts#vX.Y.Z"`,
installed with scripts off, which is why `dist/` is committed and every tag
carries the dist built from its own source. The server uses `file:../contracts`
until its first deploy.

## Working on it

```bash
npm install
npm test          # tsc, then node --test over test/
```

Commit `dist/` with every source change.
