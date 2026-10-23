import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const releaseScript = join(root, "scripts/release.mjs");
const realChangeset = join(root, "node_modules/.bin/changeset");
const timeout = 60_000;
const gitEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Release Test",
  GIT_AUTHOR_EMAIL: "release-test@example.com",
  GIT_COMMITTER_NAME: "Release Test",
  GIT_COMMITTER_EMAIL: "release-test@example.com",
};

interface Repo {
  dir: string;
  origin: string;
  bin: string;
  commandLog: string;
  requestLog: string;
}

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sh(cwd: string, command: string, ...args: string[]) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...gitEnv },
    stdio: "pipe",
  }).trim();
}

function lines(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

function writeStub(repo: Repo, name: string, body = "") {
  const path = join(repo.bin, name);
  writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${repo.commandLog}"\n${body}`);
  chmodSync(path, 0o755);
}

function commitAll(repo: Repo, message: string) {
  sh(repo.dir, "git", "add", "--all");
  sh(repo.dir, "git", "commit", "--quiet", "-m", message);
}

function createRepo(): Repo {
  const base = mkdtempSync(join(tmpdir(), "fluentbunny-release-test-"));
  scratch.push(base);
  const repo = {
    dir: join(base, "repo"),
    origin: join(base, "origin.git"),
    bin: join(base, "bin"),
    commandLog: join(base, "commands.log"),
    requestLog: join(base, "requests.log"),
  };
  mkdirSync(join(repo.dir, ".changeset"), { recursive: true });
  mkdirSync(repo.bin);
  writeStub(repo, "pnpm");
  const pkg = {
    name: "fluentbunny",
    version: "0.2.0",
    repository: { type: "git", url: "git+https://github.com/Yukiniro/fluent-mediabunny.git" },
  };
  writeFileSync(join(repo.dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  cpSync(join(root, ".changeset/config.json"), join(repo.dir, ".changeset/config.json"));
  writeFileSync(join(repo.dir, ".gitignore"), "node_modules\n");
  symlinkSync(join(root, "node_modules"), join(repo.dir, "node_modules"));
  sh(base, "git", "init", "--quiet", "--bare", "--initial-branch=main", repo.origin);
  sh(repo.dir, "git", "init", "--quiet", "--initial-branch=main");
  sh(repo.dir, "git", "remote", "add", "origin", repo.origin);
  commitAll(repo, "chore: start");
  sh(repo.dir, "git", "push", "--quiet", "origin", "main");
  return repo;
}

function addChangeset(repo: Repo, type: "patch" | "major") {
  writeFileSync(
    join(repo.dir, ".changeset", `${type}-change.md`),
    `---\n"fluentbunny": ${type}\n---\n\nFix a ${type} thing.\n`,
  );
  commitAll(repo, `fix: add a ${type} changeset`);
}

function release(repo: Repo, command: string, validateRuns?: number) {
  const imports: string[] = [];
  if (validateRuns !== undefined) {
    const mock = join(repo.bin, "fetch-mock.mjs");
    writeFileSync(
      mock,
      `import { appendFileSync } from "node:fs";
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(repo.requestLog)}, url + "\\n");
  return Response.json({ total_count: ${validateRuns}, workflow_runs: [] });
};
`,
    );
    imports.push("--import", pathToFileURL(mock).href);
  }
  return spawnSync(process.execPath, [...imports, releaseScript, command], {
    cwd: repo.dir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...gitEnv,
      PATH: [repo.bin, join(repo.dir, "node_modules/.bin"), process.env.PATH].join(delimiter),
    },
  });
}

function head(repo: Repo) {
  return sh(repo.dir, "git", "rev-parse", "HEAD");
}

function packageVersion(repo: Repo) {
  return JSON.parse(readFileSync(join(repo.dir, "package.json"), "utf8")).version;
}

function versionedRepo() {
  const repo = createRepo();
  addChangeset(repo, "patch");
  const result = release(repo, "version");
  expect(result.status, result.stderr).toBe(0);
  return repo;
}

function pushedReleaseRepo() {
  const repo = versionedRepo();
  sh(repo.dir, "git", "push", "--quiet", "origin", "main");
  writeStub(repo, "changeset", `if [ "$1" = git-tag ]; then exec "${realChangeset}" "$@"; fi\n`);
  return repo;
}

function changesetPublishCalls(repo: Repo) {
  return lines(repo.commandLog).filter((line) => line.startsWith("changeset publish"));
}

test(
  "version with only an empty changeset exits 1 and leaves the tree clean",
  () => {
    const repo = createRepo();
    sh(repo.dir, realChangeset, "add", "--empty");
    commitAll(repo, "chore: add an empty changeset");
    const before = head(repo);

    const result = release(repo, "version");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing to release");
    expect(head(repo)).toBe(before);
    expect(sh(repo.dir, "git", "status", "--porcelain")).toBe("");
  },
  timeout,
);

test(
  "version with a major changeset below 1.0 exits 1, writes nothing, and asks for minor",
  () => {
    const repo = createRepo();
    addChangeset(repo, "major");
    const before = head(repo);

    const result = release(repo, "version");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("minor");
    expect(head(repo)).toBe(before);
    expect(sh(repo.dir, "git", "status", "--porcelain")).toBe("");
    expect(packageVersion(repo)).toBe("0.2.0");
  },
  timeout,
);

test(
  "version with a dirty tree exits 1 and does not commit",
  () => {
    const repo = createRepo();
    addChangeset(repo, "patch");
    writeFileSync(join(repo.dir, "notes.txt"), "work in progress\n");
    const before = head(repo);

    const result = release(repo, "version");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("stash");
    expect(head(repo)).toBe(before);
    expect(packageVersion(repo)).toBe("0.2.0");
  },
  timeout,
);

test(
  "version with a patch changeset commits the release",
  () => {
    const repo = versionedRepo();

    expect(sh(repo.dir, "git", "log", "-1", "--format=%s")).toBe("chore(release): v0.2.1");
    expect(packageVersion(repo)).toBe("0.2.1");
    const changelog = readFileSync(join(repo.dir, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/^## 0\.2\.1$/m);
    expect(changelog).toContain("Fix a patch thing.");
    expect(existsSync(join(repo.dir, ".changeset/patch-change.md"))).toBe(false);
    expect(sh(repo.dir, "git", "status", "--porcelain")).toBe("");
  },
  timeout,
);

test(
  "a second version exits 1 and adds no commit",
  () => {
    const repo = versionedRepo();
    const before = head(repo);

    const result = release(repo, "version");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing to release");
    expect(head(repo)).toBe(before);
    expect(sh(repo.dir, "git", "status", "--porcelain")).toBe("");
  },
  timeout,
);

test(
  "publish exits 1 without publishing when HEAD is not the release commit",
  () => {
    const repo = pushedReleaseRepo();
    writeFileSync(join(repo.dir, "later.txt"), "a later change\n");
    commitAll(repo, "docs: a later change");
    sh(repo.dir, "git", "push", "--quiet", "origin", "main");

    const result = release(repo, "publish", 1);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not the release commit");
    expect(changesetPublishCalls(repo)).toEqual([]);
  },
  timeout,
);

test(
  "publish exits 1 without publishing when the release commit is not on origin/main",
  () => {
    const repo = versionedRepo();
    writeStub(repo, "changeset");

    const result = release(repo, "publish", 1);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("origin/main");
    expect(changesetPublishCalls(repo)).toEqual([]);
  },
  timeout,
);

test(
  "publish exits 1 without publishing when Validate has no successful run",
  () => {
    const repo = pushedReleaseRepo();

    const result = release(repo, "publish", 0);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Validate has not passed");
    expect(lines(repo.requestLog)).toHaveLength(1);
    expect(changesetPublishCalls(repo)).toEqual([]);
  },
  timeout,
);

test(
  "publish from the pushed release commit publishes, tags, and pushes only that tag",
  () => {
    const repo = pushedReleaseRepo();
    const sha = head(repo);

    const result = release(repo, "publish", 1);

    expect(result.status, result.stderr).toBe(0);
    const requests = lines(repo.requestLog).map((line) => new URL(line));
    expect(requests.map((url) => url.pathname)).toEqual([
      "/repos/Yukiniro/fluent-mediabunny/actions/workflows/ci.yml/runs",
    ]);
    expect(requests[0].searchParams.get("head_sha")).toBe(sha);
    expect(requests[0].searchParams.get("status")).toBe("success");
    expect(lines(repo.commandLog)).toEqual([
      "pnpm whoami",
      "pnpm install --frozen-lockfile",
      "changeset publish --no-git-tag",
      "changeset git-tag",
    ]);
    expect(sh(repo.origin, "git", "tag", "--list")).toBe("v0.2.1");
    expect(sh(repo.origin, "git", "rev-parse", "v0.2.1^{commit}")).toBe(sha);
    expect(sh(repo.origin, "git", "rev-parse", "main")).toBe(sha);
  },
  timeout,
);
