import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { navDrift } from "../website/invariants.ts";

test("localized navigation leaves locale prefixes to Rspress", () => {
  const readNav = (locale: string) =>
    JSON.parse(readFileSync(`website/docs/${locale}/_nav.json`, "utf8")) as {
      link: string;
    }[];
  expect(readNav("zh").map((item) => item.link)).toEqual(readNav("en").map((item) => item.link));
});

test("navigation validation rejects a manually added locale prefix", () => {
  expect(navDrift([{ link: "/api/" }], [{ link: "/zh/api/" }], "_nav.json")).toEqual([
    "docs/zh/_nav.json[0].link does not match docs/en/_nav.json[0].link.",
  ]);
});
