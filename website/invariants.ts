import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function errorCodesIn(source: string): string[] {
  const start = source.indexOf("export type ErrorCode =");
  if (start < 0) return [];
  const end = source.indexOf(";", start);
  if (end < 0) return [];
  const codes: string[] = [];
  for (const match of source.slice(start, end).matchAll(/"([A-Z_]+)"/g)) {
    const code = match[1];
    if (code) codes.push(code);
  }
  return codes;
}

export function metaDrift(english: unknown, chinese: unknown, path: string): string[] {
  if (stable(english) === stable(chinese)) return [];
  return [`docs/zh/${path} does not deep-equal docs/en/${path}.`];
}

export function navFieldMatches(english: string, chinese: string): boolean {
  return chinese === english;
}

export function navDrift(english: unknown, chinese: unknown, path: string): string[] {
  const left = navEntries(english, `docs/en/${path}`);
  const right = navEntries(chinese, `docs/zh/${path}`);
  const problems = [...left.problems, ...right.problems];
  if (left.entries.length !== right.entries.length) {
    problems.push(
      `docs/zh/${path} has ${right.entries.length} entries and docs/en/${path} has ${left.entries.length}.`,
    );
    return problems;
  }
  for (let index = 0; index < left.entries.length; index++) {
    const en = left.entries[index];
    const zh = right.entries[index];
    if (!en || !zh) continue;
    if (!navFieldMatches(en.link, zh.link)) {
      problems.push(
        `docs/zh/${path}[${index}].link does not match docs/en/${path}[${index}].link.`,
      );
    }
    if (en.activeMatch !== zh.activeMatch && !sameOptional(en.activeMatch, zh.activeMatch)) {
      problems.push(
        `docs/zh/${path}[${index}].activeMatch does not match docs/en/${path}[${index}].activeMatch.`,
      );
    }
  }
  return problems;
}

export function missingErrorCodes(
  codes: readonly string[],
  pages: readonly { path: string; text: string }[],
): string[] {
  if (codes.length === 0) return ["ErrorCode list is empty."];
  const problems: string[] = [];
  for (const page of pages) {
    for (const code of codes) {
      if (!page.text.includes(`\`${code}\``))
        problems.push(`${page.path} is missing inline code ${code}.`);
    }
  }
  return problems;
}

export function checkDocs(docsDir: string, typesPath: string): string[] {
  const english = join(docsDir, "en");
  const chinese = join(docsDir, "zh");
  return [
    ...pairDrift(english, chinese, "_meta.json", (en, zh, path) => metaDrift(en, zh, path)),
    ...pairDrift(english, chinese, "_nav.json", (en, zh, path) => navDrift(en, zh, path)),
    ...errorCodeDrift(docsDir, typesPath),
  ];
}

function sameOptional(english: string | undefined, chinese: string | undefined): boolean {
  if (english === undefined || chinese === undefined) return english === chinese;
  return navFieldMatches(english, chinese);
}

function pairDrift(
  englishRoot: string,
  chineseRoot: string,
  name: string,
  compare: (english: unknown, chinese: unknown, path: string) => string[],
): string[] {
  const english = filesNamed(englishRoot, name);
  const chinese = filesNamed(chineseRoot, name);
  const problems: string[] = [];
  const paths = new Set([...english.keys(), ...chinese.keys()]);
  for (const path of [...paths].sort()) {
    const enPath = english.get(path);
    const zhPath = chinese.get(path);
    if (!enPath) {
      problems.push(`docs/zh/${path} has no English twin.`);
      continue;
    }
    if (!zhPath) {
      problems.push(`docs/en/${path} has no Chinese twin.`);
      continue;
    }
    const en = readJson(enPath);
    const zh = readJson(zhPath);
    if (!en.ok) problems.push(`docs/en/${path} is not JSON.`);
    if (!zh.ok) problems.push(`docs/zh/${path} is not JSON.`);
    if (en.ok && zh.ok) problems.push(...compare(en.value, zh.value, path));
  }
  return problems;
}

function errorCodeDrift(docsDir: string, typesPath: string): string[] {
  let source: string;
  try {
    source = readFileSync(typesPath, "utf8");
  } catch {
    return [`Cannot read ${typesPath}.`];
  }
  const codes = errorCodesIn(source);
  const pages = ["en/api/errors.md", "zh/api/errors.md"].map((path) => {
    const absolute = join(docsDir, path);
    try {
      return { path: `docs/${path}`, text: readFileSync(absolute, "utf8") };
    } catch {
      return { path: `docs/${path}`, text: "" };
    }
  });
  const problems = missingErrorCodes(codes, pages);
  for (const page of pages) {
    if (page.text === "" && codes.length > 0) problems.unshift(`${page.path} is missing.`);
  }
  return problems;
}

type NavEntry = { link: string; activeMatch: string | undefined };

function navEntries(value: unknown, label: string): { entries: NavEntry[]; problems: string[] } {
  if (!Array.isArray(value)) return { entries: [], problems: [`${label} is not an array.`] };
  const entries: NavEntry[] = [];
  const problems: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${label}[${index}] is not an object.`);
      continue;
    }
    const record = item as Record<string, unknown>;
    if ("items" in record) problems.push(`${label}[${index}] has items.`);
    if (typeof record.link !== "string") {
      problems.push(`${label}[${index}] link is not a string.`);
      continue;
    }
    if (record.activeMatch !== undefined && typeof record.activeMatch !== "string") {
      problems.push(`${label}[${index}] activeMatch is not a string.`);
      continue;
    }
    entries.push({
      link: record.link,
      activeMatch: typeof record.activeMatch === "string" ? record.activeMatch : undefined,
    });
  }
  return { entries, problems };
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false };
  }
}

function filesNamed(root: string, name: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of walk(root)) {
    if (path.endsWith(`${sep}${name}`)) found.set(relative(root, path).split(sep).join("/"), path);
  }
  return found;
}

function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

function stable(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
    return sorted;
  }
  return value;
}
