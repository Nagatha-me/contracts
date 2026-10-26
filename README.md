# @nagatha/contracts

The wire contract between the Nagatha server, the web portal and, later, the
apps: socket event names and payloads, sync row types, RPC methods, the REST
request and response shapes, the signal document schema, and the error codes.
ESM, TypeScript, `zod` 4 as the only dependency.

## What is in it

| File | Contents |
|---|---|
| `src/events.ts` | `SocketEventName` (`SYNC_DATA`, `SYNC_COMPLETE`, `DIFF_SYNC`, `SYNC_RESET`, `SOCKET_EVENT`, `RPC`), the handshake `{ token, cursor?, scope? }`, `SyncScope`, every payload, the per-entity cursor rule, `EventType`, `verbOf` |
| `src/rows.ts` | `SyncType` and the row types `UserRow`, `SignalRollupRow` (with `pulses`, the per-kind counters, `devices`, `newProgramsWeek` and `newProgramsMonth`), `SignalNameRollupRow`, `SignalHourRollupRow` and `SignalActivesRow` (0.4.0, with the rolling window arithmetic), plus the id builders |
| `src/rpc.ts` | `RpcRequest`, `RpcResponse`, `RpcMethod` (`ping`, `admin.whoami`) with inputs and outputs |
| `src/auth.ts` | `GET /auth/socket-token` response, `POST /admin/claim` request and response |
| `src/signals.ts` | The day key and assertion protocol, documented at the top; `SignalDocumentV1` (zod; per-array caps, at most 400 items and 2,000 routine blocks per document, no control characters in any string); `PulseDocumentV1`; the program token rule and `programPeriods`; the `GET /signals/challenge`, `POST /signals/key`, `POST /signals/pulse` and `POST /signals` shapes; the phone's `gapDays` and first-foreground rules and `signalGapDays`; `SignalErrorCode` with each code's HTTP status |
| `src/errors.ts` | `ErrorCode`, `WireError`, `RestErrorBody` |

## Rules a client must follow

- **Per-entity cursor.** Keep the highest cursor applied to each entity and
  ignore any `SOCKET_EVENT` or `DIFF_SYNC` upserted row (each carries
  `cursor`) at or below it. Never compare an envelope with the global cursor:
  events on different rows can commit out of cursor order. Clear the
  per-entity cursors on `SYNC_RESET` and before a full sync. The full rule is
  at the top of `src/events.ts`.
- **Scope.** Keep `SYNC_COMPLETE.scope` with the cursor and send both in the
  handshake. A cursor without a scope, or with a scope that no longer
  matches, is answered with `SYNC_RESET { reason: "scope_changed" }`.
- **`programs` in `SignalRollupRow`** counts programs uploaded (the sum of
  each document's program count), not unique programs. Unique programs are
  `newProgramsWeek` summed over one ISO week and `newProgramsMonth` summed
  over one month (0.3.0).

- **Signals 0.2.0.** `POST /signals` is signed with the day key by an App
  Attest assertion; the per-upload attestation of 0.1 is gone. Attest the
  day's key with `POST /signals/key` first. The whole protocol is at the top of
  `src/signals.ts`.
- **Signals 0.3.0.** `POST /signals/key` takes `context` (`{ region,
  timeZone }`) and counts the phone in the rollup's `devices`. The stable
  program token is gone: programs and run pulses carry `weekToken` and
  `monthToken`, derived on the phone by the rule at the top of
  `src/signals.ts`, so nothing links two uploads across a month. Pulses own
  the live counters: a program document no longer adds its week's
  `nagsShown`, `nagsCompleted`, `runsStarted` or `runsFinished` to the
  rollups.
- **Signals 0.4.0, rolling actives.** `POST /signals/key` takes the full
  context (`appBuild`, `osMajor`, `deviceClass`, `language`, `region`,
  `timeZone`) plus `gapDays`, 1 to 30 or `null`; the 0.3.0 context of region
  and time zone alone is refused, so 0.3.0 phone builds cannot attest (none
  shipped). The phone attests on its first foreground of each UTC day and
  computes `gapDays` by the rules at the top of `src/signals.ts`. Two sync
  types are added after the existing ones: `signal_hour_rollup` (devices and
  pulses per UTC hour and time zone, the last 48 hours) and `signal_actives`
  (rolling 7 and 30 day active phones and new today, per region and per time
  zone), with `signal_hour_rollup.updated` and `signal_actives.updated`. The
  live 24 hour figure is the client's to roll from the hour rows.

## Versioning

SemVer, released with `npm run release` (`scripts/release.mjs`, the same tool
nutmegs uses): it commits pending work, rebuilds `dist/`, bumps the version and
pushes an annotated `vX.Y.Z` tag.

- Additive optional fields, new event names, error codes or RPC methods: minor.
- Renames, type changes, new required fields, removals: major, shipped in two
  steps (server accepts both shapes, clients move, the old shape goes).
- Comment and documentation fixes: patch.

## Consuming it

Consumers pin a tag: `"@nagatha/contracts": "github:Nagatha-me/contracts#vX.Y.Z"`,
installed with scripts off, which is why `dist/` is committed and every tag
carries the dist built from its own source. The server and the web portal both
pin a tag; link `../contracts` only while working on a change, never commit it.

## Working on it

```bash
npm install
npm run lint      # tsc --noEmit (there is no eslint here yet)
npm test          # tsc, then node --test over test/
```

Commit `dist/` with every source change.
