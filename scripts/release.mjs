import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseSubject = (version) => `chore(release): v${version}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const { status, error } = spawnSync(command, args, { stdio: "inherit" });
  if (error) fail(error.message);
  if (status !== 0) process.exit(status ?? 1);
}

function read(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readPackage() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const match = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? "");
  if (!match) fail("package.json repository.url must point at GitHub.");
  return { version: pkg.version, repoPath: match[1] };
}

function assertCleanTree() {
  if (read("git", ["status", "--porcelain"]) !== "") {
    fail(
      "Commit or stash your changes first (git stash --include-untracked). " +
        "If release:version stopped midway, these changes are its output. Stash or discard them, then rerun.",
    );
  }
}

function plannedReleases() {
  const dir = mkdtempSync(join(tmpdir(), "fluent-mediabunny-release-"));
  run("changeset", ["status", `--output=${join(dir, "plan.json")}`]);
  const { releases } = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
  rmSync(dir, { recursive: true });
  return releases.filter((release) => release.type !== "none");
}

function version() {
  assertCleanTree();
  // Empty changesets bump nothing, yet `changeset version` would still consume them.
  const [release] = plannedReleases();
  if (!release) fail("Nothing to release. No pending changeset bumps the version.");
  if (release.type === "major" && release.oldVersion.startsWith("0.")) {
    fail(
      `A major changeset would release ${release.name} ${release.newVersion}. ` +
        "Change that changeset to minor, or edit this rule in scripts/release.mjs in the pull request that ships 1.0.",
    );
  }
  console.log(`${release.name} ${release.oldVersion} -> ${release.newVersion} (${release.type})`);
  run("changeset", ["version"]);
  run("vp", ["fmt", "CHANGELOG.md"]);
  run("git", ["add", "package.json", "CHANGELOG.md", ".changeset"]);
  run("git", ["commit", "-m", releaseSubject(readPackage().version)]);
  console.log("Review with git show, push with git push origin main, then wait for Validate.");
}

// `release:publish` runs this first because Changesets hides lifecycle script stderr.
async function preflight() {
  assertCleanTree();
  const { version, repoPath } = readPackage();
  const sha = read("git", ["rev-parse", "HEAD"]);
  if (read("git", ["log", "-1", "--format=%s"]) !== releaseSubject(version)) {
    fail(
      `HEAD is not the release commit for v${version}. Run pnpm release:version, or check out that commit.`,
    );
  }
  run("git", ["fetch", "--quiet", "origin", "main"]);
  if (read("git", ["merge-base", "--is-ancestor", sha, "origin/main"]) === null) {
    fail("The release commit is not on origin/main. Push it with git push origin main.");
  }
  const runs = await fetch(
    `https://api.github.com/repos/${repoPath}/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=1`,
    { headers: { accept: "application/vnd.github+json" } },
  );
  if (!runs.ok) fail(`Could not read the Validate result for ${sha} (HTTP ${runs.status}).`);
  const { total_count } = await runs.json();
  if (!(total_count > 0)) {
    fail(
      `Validate has not passed for ${sha}. Wait for https://github.com/${repoPath}/actions/workflows/ci.yml, then rerun.`,
    );
  }
  if (read("pnpm", ["whoami"]) === null) fail("Not logged in to npm. Run npm login, then rerun.");
}

async function publish() {
  await preflight();
  run("pnpm", ["install", "--frozen-lockfile"]);
  // `changeset git-tag` is the only tag writer, so a rerun tags a version that npm already has.
  run("changeset", ["publish", "--no-git-tag"]);
  run("changeset", ["git-tag"]);
  run("git", ["push", "origin", `refs/tags/v${readPackage().version}`]);
}

const commands = { version, publish, preflight };
const command = commands[process.argv[2]];
if (!command) fail(`Usage: node scripts/release.mjs <${Object.keys(commands).join("|")}>`);
await command();
