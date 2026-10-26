// scripts/release.mjs — interactive semver release.
//
// Flow:
//   1. If the working tree is dirty: prompt for a commit message, commit all
//      changes with `git add -A`.
//   2. If the branch is ahead of its upstream: push the branch first so the
//      tag lands on a remotely-known commit.
//   3. Read latest vX.Y.Z tag AND package.json version (if present). The
//      baseline is whichever is higher.
//   4. Offer patch/minor/major options. If package.json is ahead of the
//      latest tag, also offer a [0] "release current version as-is" option
//      (useful for the first release when you've pre-set the version).
//   5. After confirmation: rebuild dist (`npm run build`) and `git add dist`
//      so the tag can never carry stale/missing dist. A failed build aborts
//      the release before anything is tagged.
//   6. If package.json.version doesn't match the new tag, bump it + refresh
//      lockfile, then commit "release: vX.Y.Z" (including the freshly-built
//      dist) + push. If the version is unchanged but the build produced dist
//      changes, still commit them so the tag always includes current dist.
//   7. Create the annotated tag and push it.
//
// Consumers install these packages as git deps with `--ignore-scripts`, which
// suppresses the `prepare: tsc` build — so dist MUST be committed, and the
// commit a tag points at MUST contain dist built from that exact source.
//
// No external deps — Node built-ins only. Run via `npm run release`.

import { execSync, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function runInherit(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${r.status}`);
  }
}

function getLatestTag() {
  try {
    const list = run("git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname");
    return list.split("\n").find(Boolean) || "v0.0.0";
  } catch {
    return "v0.0.0";
  }
}

function parseSemver(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!m) throw new Error(`Not plain semver: ${tag}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function format(s) {
  return `v${s.major}.${s.minor}.${s.patch}`;
}

function bump(current, kind) {
  if (kind === "major") return { major: current.major + 1, minor: 0, patch: 0 };
  if (kind === "minor") return { major: current.major, minor: current.minor + 1, patch: 0 };
  if (kind === "patch") return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  throw new Error(`Unknown bump kind: ${kind}`);
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function getBranch() {
  return run("git branch --show-current");
}

function getDirtyFiles() {
  return run("git status --porcelain");
}

function getAheadCount() {
  try {
    return Number(run("git rev-list @{u}..HEAD --count"));
  } catch {
    return null;
  }
}

function readPackageJson() {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const json = JSON.parse(raw);
    return { path: pkgPath, json, raw };
  } catch {
    return null;
  }
}

function writePackageJsonVersion(pkgInfo, newVersion) {
  pkgInfo.json.version = newVersion;
  fs.writeFileSync(pkgInfo.path, JSON.stringify(pkgInfo.json, null, 2) + "\n");
}

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    const branch = getBranch();
    if (branch !== "main" && branch !== "master") {
      const proceed = (await rl.question(
        `You are on branch '${branch}', not main. Continue? [y/N] `,
      ))
        .trim()
        .toLowerCase();
      if (proceed !== "y" && proceed !== "yes") {
        console.log("Cancelled.");
        return;
      }
    }

    // Step 1 — commit any pending work.
    const dirty = getDirtyFiles();
    if (dirty) {
      console.log("Uncommitted changes:");
      console.log(dirty.split("\n").map((l) => "  " + l).join("\n"));
      console.log();
      const msg = (await rl.question("Commit message (empty = cancel): ")).trim();
      if (!msg) {
        console.log("Cancelled.");
        return;
      }
      console.log("Staging and committing…");
      runInherit("git", ["add", "-A"]);
      runInherit("git", ["commit", "-m", msg]);
    }

    // Step 2 — push the branch if it's ahead of upstream.
    const ahead = getAheadCount();
    if (ahead === null) {
      throw new Error(
        `Branch '${branch}' has no upstream set. Run: git push -u origin ${branch}`,
      );
    }
    if (ahead > 0) {
      console.log(`Branch is ${ahead} commit(s) ahead of upstream. Pushing…`);
      runInherit("git", ["push"]);
    }

    // Step 3 — figure out baseline version.
    const latest = getLatestTag();
    const tagSemver = parseSemver(latest);
    const pkgInfo = readPackageJson();
    const pkgSemver = pkgInfo?.json?.version ? parseSemver(pkgInfo.json.version) : null;

    // Baseline = max(tag, pkg)
    const pkgAhead = pkgSemver && cmpSemver(pkgSemver, tagSemver) > 0;
    const current = pkgAhead ? pkgSemver : tagSemver;

    console.log();
    console.log(`Latest git tag:    ${latest}`);
    if (pkgSemver) console.log(`package.json:      v${pkgInfo.json.version}`);
    console.log(`Baseline:          ${format(current)}`);
    console.log();

    if (pkgAhead) {
      console.log(`  [0] release current package.json version  → ${format(current)}`);
    }
    console.log(`  [1] patch  → ${format(bump(current, "patch"))}`);
    console.log(`  [2] minor  → ${format(bump(current, "minor"))}`);
    console.log(`  [3] major  → ${format(bump(current, "major"))}`);
    console.log(`  [q] quit`);
    console.log();

    const choice = (await rl.question("Choose: ")).trim().toLowerCase();
    let newSemver = null;
    if (pkgAhead && choice === "0") newSemver = current;
    else if (choice === "1" || choice === "patch") newSemver = bump(current, "patch");
    else if (choice === "2" || choice === "minor") newSemver = bump(current, "minor");
    else if (choice === "3" || choice === "major") newSemver = bump(current, "major");
    if (!newSemver) {
      console.log("Cancelled.");
      return;
    }

    const newTag = format(newSemver);
    const newVersionStr = `${newSemver.major}.${newSemver.minor}.${newSemver.patch}`;

    const confirm = (await rl.question(
      `Tag ${newTag} and push to origin? [y/N] `,
    ))
      .trim()
      .toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      console.log("Cancelled.");
      return;
    }

    // Step 4 — rebuild dist so the tag carries fresh output.
    // Consumers install with `--ignore-scripts` (no prepare build), so the
    // committed dist is what ships. Build BEFORE tagging; a build failure
    // throws and aborts the whole release — we never tag broken output.
    console.log("Building dist (npm run build)…");
    runInherit("npm", ["run", "build"]);
    // Stage dist now; it will ride whichever release commit we make below.
    runInherit("git", ["add", "dist"]);

    // Step 5 — bump package.json if needed and commit the release state.
    const lockPath = path.join(process.cwd(), "package-lock.json");
    if (pkgInfo && pkgInfo.json.version && pkgInfo.json.version !== newVersionStr) {
      console.log(`Bumping package.json: ${pkgInfo.json.version} → ${newVersionStr}`);
      writePackageJsonVersion(pkgInfo, newVersionStr);

      if (fs.existsSync(lockPath)) {
        console.log("Refreshing package-lock.json…");
        runInherit("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
      }

      runInherit("git", ["add", "package.json"]);
      if (fs.existsSync(lockPath)) {
        runInherit("git", ["add", "package-lock.json"]);
      }
      // dist is already staged above → it rides this release commit.
      runInherit("git", ["commit", "-m", `release: ${newTag}`]);
      console.log("Pushing release commit…");
      runInherit("git", ["push"]);
    } else {
      // No version change (e.g. [0] release-as-is, or pkg already matches).
      // The build may still have refreshed dist — if anything is staged,
      // commit it so the tag always points at a commit containing current dist.
      const staged = run("git diff --cached --name-only");
      if (staged) {
        console.log("Committing refreshed dist…");
        runInherit("git", ["commit", "-m", `release: ${newTag}`]);
        console.log("Pushing release commit…");
        runInherit("git", ["push"]);
      }
    }

    // Step 6 — create and push the tag.
    console.log(`Creating tag ${newTag}…`);
    runInherit("git", ["tag", "-a", newTag, "-m", `Release ${newTag}`]);
    console.log(`Pushing ${newTag}…`);
    runInherit("git", ["push", "origin", newTag]);
    console.log(`✓ ${newTag} pushed.`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
