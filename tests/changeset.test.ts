import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const changesetDir = join(root, ".changeset");
const bin = (name: string) => join(root, "node_modules/.bin", name);

test("vp fmt --check accepts an empty changeset written by the CLI", () => {
  const before = new Set(readdirSync(changesetDir));
  const added = () => readdirSync(changesetDir).filter((name) => !before.has(name));
  try {
    execFileSync(bin("changeset"), ["add", "--empty"], { cwd: root, stdio: "pipe" });
    expect(added()).toEqual([expect.stringMatching(/\.md$/)]);
    expect(() =>
      execFileSync(bin("vp"), ["fmt", "--check"], { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  } finally {
    for (const name of added()) rmSync(join(changesetDir, name));
  }
  expect(added()).toEqual([]);
}, 30_000);
