/**
 * @nagatha/contracts: the wire contract between the Nagatha server, the web
 * portal and (later) the apps.
 *
 * SemVer. Every change is versioned and released with `npm run release`:
 *  - additive optional fields, new event names, new error codes, new RPC
 *    methods: MINOR;
 *  - renames, type changes, new required fields, removals: MAJOR, and they
 *    ship in two steps (the server accepts both shapes first, clients move,
 *    then the old shape goes), so no deploy order can break a live client;
 *  - comment and documentation fixes: PATCH.
 *
 * Consumers pin a git tag (`github:<org>/nagatha-contracts#vX.Y.Z`) and install
 * with scripts off, so `dist/` is committed and a tag always carries the dist
 * built from its own source.
 */
export * from "./errors.js";
export * from "./rows.js";
export * from "./events.js";
export * from "./rpc.js";
export * from "./auth.js";
export * from "./signals.js";
//# sourceMappingURL=index.d.ts.map