#!/usr/bin/env node
/**
 * Verification scaffolding for fluentbunny.
 * Manages an isolated Vite harness + Playwright drive of window.mediaAPI.
 * Usage: node helpers/verify-fmb.mjs <launch|doctor|drive|cleanup> [feature-id]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../../..");
const require = createRequire(import.meta.url);

/** Playwright is a transitive dep of @playwright/test (pnpm-isolated). */
async function loadPlaywright() {
  const testEntry = require.resolve("@playwright/test/package.json", {
    paths: [REPO],
  });
  const fromTest = createRequire(testEntry);
  return fromTest("playwright");
}

const RUN_ID = process.env.FMB_VERIFY_RUN_ID || "default";
const STATE_DIR = process.env.FMB_VERIFY_STATE_DIR || `/tmp/fmb-verify-${RUN_ID}`;
const STATE_FILE = join(STATE_DIR, "state.json");
const PORT = Number(process.env.FMB_VERIFY_PORT || 4173);
const EVIDENCE_ROOT =
  process.env.FMB_VERIFY_EVIDENCE || resolve(REPO, "artifacts/verify-fluentbunny");

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function url() {
  return `http://127.0.0.1:${PORT}/`;
}

async function waitReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url());
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Harness not ready at ${url()} within ${timeoutMs}ms`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cmdLaunch() {
  const existing = loadState();
  if (existing?.pid && isAlive(existing.pid)) {
    console.log(
      JSON.stringify({
        ok: true,
        reused: true,
        url: existing.url,
        pid: existing.pid,
        evidenceDir: existing.evidenceDir,
      }),
    );
    return;
  }

  mkdirSync(STATE_DIR, { recursive: true });
  const evidenceDir = join(EVIDENCE_ROOT, RUN_ID);
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(STATE_DIR, "dev.log");
  const logFd = writeFileSync(logPath, "");
  void logFd;
  const out = require("node:fs").openSync(logPath, "a");

  const child = spawn(
    "node",
    [
      resolve(REPO, "node_modules/vite-plus/bin/vp"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
    ],
    {
      cwd: REPO,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env },
    },
  );
  child.unref();

  const state = {
    pid: child.pid,
    port: PORT,
    url: url(),
    evidenceDir,
    startedAt: new Date().toISOString(),
    logPath,
  };
  saveState(state);

  try {
    await waitReady();
  } catch (e) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    throw e;
  }

  console.log(JSON.stringify({ ok: true, reused: false, ...state }));
}

async function cmdDoctor() {
  const state = loadState();
  const report = {
    ok: true,
    url: url(),
    stateFile: STATE_FILE,
    harnessProcess: null,
    pageLoads: false,
    mediaAPI: false,
    fixtureAvMp4: false,
    evidenceDir: state?.evidenceDir || null,
    problems: [],
  };

  if (!state?.pid) {
    report.ok = false;
    report.problems.push("No launch state. Run launch first.");
  } else if (!isAlive(state.pid)) {
    report.ok = false;
    report.harnessProcess = { pid: state.pid, alive: false };
    report.problems.push(`Harness pid ${state.pid} is not running.`);
  } else {
    report.harnessProcess = { pid: state.pid, alive: true, ownedByUs: true };
  }

  try {
    const res = await fetch(url());
    report.pageLoads = res.ok;
    if (!res.ok) {
      report.ok = false;
      report.problems.push(`GET / returned ${res.status}`);
    }
  } catch (e) {
    report.ok = false;
    report.problems.push(`GET / failed: ${e.message}`);
  }

  try {
    const fixture = await fetch(new URL("/fixtures/av.mp4", url()));
    report.fixtureAvMp4 = fixture.ok;
    if (!fixture.ok) {
      report.ok = false;
      report.problems.push(`Fixture /fixtures/av.mp4 returned ${fixture.status}`);
    }
  } catch (e) {
    report.ok = false;
    report.problems.push(`Fixture fetch failed: ${e.message}`);
  }

  if (report.pageLoads) {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(url(), { waitUntil: "networkidle" });
      report.mediaAPI = await page.evaluate(() => !!window.mediaAPI?.media);
      if (!report.mediaAPI) {
        report.ok = false;
        report.problems.push("window.mediaAPI.media missing after goto /");
      }
      const title = await page.title();
      report.pageTitle = title;
      if (!title.includes("fluentbunny")) {
        report.ok = false;
        report.problems.push(`Unexpected title: ${title}`);
      }
    } finally {
      await browser.close();
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

async function withPage(fn) {
  const state = loadState();
  if (!state?.pid || !isAlive(state.pid)) {
    throw new Error("Harness not launched. Run launch, then doctor.");
  }
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url(), { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!window.mediaAPI);
    return await fn(page, state);
  } finally {
    await browser.close();
  }
}

async function driveConvertCopy(page, state) {
  const featureDir = join(state.evidenceDir, "convert-copy");
  mkdirSync(featureDir, { recursive: true });

  const result = await page.evaluate(async () => {
    const { media, probe } = window.mediaAPI;
    const blob = new Blob([await (await fetch("/fixtures/av.mp4")).arrayBuffer()]);
    const out = await media(blob).format("mp4").mode("copy").run();
    const info = await probe(out.blob, { duration: "scan" });
    const bytes = Array.from(new Uint8Array(await out.blob.arrayBuffer()));
    return {
      kind: out.kind,
      size: out.size,
      mimeType: out.mimeType,
      trackCount: info.tracks.length,
      codecs: info.tracks.map((t) => t.codec),
      bytes,
    };
  });

  const outPath = join(featureDir, "output.mp4");
  writeFileSync(outPath, Buffer.from(result.bytes));
  delete result.bytes;

  let ffprobe = null;
  try {
    ffprobe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=format_name,duration,size:stream=codec_type,codec_name",
          "-of",
          "json",
          outPath,
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (e) {
    ffprobe = { error: String(e) };
  }

  const proof = {
    featureId: "convert-copy",
    entryPoint: "window.mediaAPI.media(...).format('mp4').mode('copy').run()",
    harnessUrl: url(),
    result: {
      kind: result.kind,
      size: result.size,
      mimeType: result.mimeType,
      trackCount: result.trackCount,
      codecs: result.codecs,
    },
    ffprobe,
    outputPath: outPath,
    ok:
      result.kind === "blob" &&
      result.size > 0 &&
      result.trackCount >= 1 &&
      Array.isArray(ffprobe?.streams) &&
      ffprobe.streams.length >= 1,
  };
  writeFileSync(join(featureDir, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.ok) process.exitCode = 1;
}

async function driveThumbnailsBatch(page, state) {
  const featureDir = join(state.evidenceDir, "thumbnails-batch");
  mkdirSync(featureDir, { recursive: true });

  const result = await page.evaluate(async () => {
    const { thumbnails } = window.mediaAPI;
    const items = [];
    const batch = thumbnails(new URL("/fixtures/markers.mp4", location.href), {
      times: [0.5, 1.5, 2.5],
      type: "image/jpeg",
      width: 80,
    });
    for await (const item of batch) {
      if (!item.image) throw new Error(`missing image ${item.index}`);
      items.push({
        index: item.index,
        width: item.image.width,
        height: item.image.height,
        mime: item.image.blob.type,
        requestedTime: item.image.requestedTime,
        sourceTimestamp: item.image.sourceTimestamp,
        byteLength: item.image.blob.size,
      });
      const buf = new Uint8Array(await item.image.blob.arrayBuffer());
      items[items.length - 1]._bytes = Array.from(buf);
    }
    return items;
  });

  for (const item of result) {
    writeFileSync(join(featureDir, `frame-${item.index}.jpg`), Buffer.from(item._bytes));
    delete item._bytes;
  }

  const proof = {
    featureId: "thumbnails-batch",
    entryPoint: "window.mediaAPI.thumbnails(url, { times, type, width })",
    harnessUrl: url(),
    frames: result,
    ok: result.length === 3 && result.every((f) => f.byteLength > 0 && f.width === 80),
  };
  writeFileSync(join(featureDir, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.ok) process.exitCode = 1;
}

async function driveCancelBeforeCommit(page, state) {
  const featureDir = join(state.evidenceDir, "cancel-before-commit");
  mkdirSync(featureDir, { recursive: true });

  const result = await page.evaluate(async () => {
    const { media, MediaError } = window.mediaAPI;
    const blob = new Blob([await (await fetch("/fixtures/audio.wav")).arrayBuffer()]);
    const events = [];
    const handle = {
      kind: "file",
      name: "cancel.wav",
      isSameEntry: async () => false,
      queryPermission: async () => "granted",
      createWritable: async () => {
        events.push("open");
        const controller = { abortFn: null };
        return {
          write: async () => {
            events.push("write");
          },
          close: async () => {
            events.push("close");
          },
          abort: async () => {
            events.push("abort");
          },
          _controller: controller,
        };
      },
    };

    const ac = new AbortController();
    // Abort before run starts processing deeply: pre-aborted signal.
    ac.abort();
    let code = null;
    let targetState = null;
    try {
      await media(blob)
        .format("wav")
        .run({ target: { type: "file", handle }, signal: ac.signal });
    } catch (e) {
      code = e instanceof MediaError ? e.code : e?.code || "UNKNOWN";
      targetState = e?.targetState ?? null;
    }

    // Mid-write cancel: abort during first write.
    const events2 = [];
    const ac2 = new AbortController();
    const handle2 = {
      kind: "file",
      name: "cancel2.wav",
      isSameEntry: async () => false,
      queryPermission: async () => "granted",
      createWritable: async () => ({
        write: async () => {
          events2.push("write");
          ac2.abort();
        },
        close: async () => {
          events2.push("close");
        },
        abort: async () => {
          events2.push("abort");
        },
      }),
    };
    let code2 = null;
    try {
      await media(blob)
        .format("wav")
        .run({ target: { type: "file", handle: handle2 }, signal: ac2.signal });
    } catch (e) {
      code2 = e instanceof MediaError ? e.code : e?.code || "UNKNOWN";
    }

    return {
      preAborted: { code, targetState, events },
      midWrite: { code: code2, events: events2 },
    };
  });

  const proof = {
    featureId: "cancel-before-commit",
    entryPoint: "media(...).run({ target: file, signal })",
    harnessUrl: url(),
    result,
    ok:
      result.preAborted.code === "ABORTED" &&
      !result.preAborted.events.includes("close") &&
      result.midWrite.code === "ABORTED" &&
      result.midWrite.events.includes("abort") &&
      !result.midWrite.events.includes("close"),
  };
  writeFileSync(join(featureDir, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.ok) process.exitCode = 1;
}

async function driveProbeMedia(page, state) {
  const featureDir = join(state.evidenceDir, "probe-media");
  mkdirSync(featureDir, { recursive: true });

  const result = await page.evaluate(async () => {
    const { probe } = window.mediaAPI;
    const blob = new Blob([await (await fetch("/fixtures/av.mp4")).arrayBuffer()]);
    const info = await probe(blob, { duration: "scan" });
    return {
      trackCount: info.tracks.length,
      types: info.tracks.map((t) => t.type),
      duration: info.duration,
      hasVideo: info.tracks.some((t) => t.type === "video"),
      hasAudio: info.tracks.some((t) => t.type === "audio"),
    };
  });

  const proof = {
    featureId: "probe-media",
    entryPoint: "window.mediaAPI.probe(blob, { duration: 'scan' })",
    harnessUrl: url(),
    result,
    ok: result.trackCount >= 2 && result.hasVideo && result.hasAudio,
  };
  writeFileSync(join(featureDir, "proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.ok) process.exitCode = 1;
}

async function cmdDrive(featureId) {
  const drivers = {
    "convert-copy": driveConvertCopy,
    "thumbnails-batch": driveThumbnailsBatch,
    "cancel-before-commit": driveCancelBeforeCommit,
    "probe-media": driveProbeMedia,
  };
  const driver = drivers[featureId];
  if (!driver) {
    console.error(`Unknown feature "${featureId}". Known: ${Object.keys(drivers).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  await withPage((page, state) => driver(page, state));
}

function cmdCleanup() {
  const state = loadState();
  if (state?.pid && isAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isAlive(state.pid)) {
      execFileSync("sleep", ["0.1"]);
    }
    if (isAlive(state.pid)) {
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  // Remove launch state only. Never delete evidence.
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  if (existsSync(join(STATE_DIR, "dev.log"))) {
    try {
      unlinkSync(join(STATE_DIR, "dev.log"));
    } catch {
      /* ignore */
    }
  }
  console.log(
    JSON.stringify({
      ok: true,
      cleanedPid: state?.pid ?? null,
      evidencePreservedAt: state?.evidenceDir ?? EVIDENCE_ROOT,
    }),
  );
}

const [cmd, featureId] = process.argv.slice(2);
const commands = {
  launch: cmdLaunch,
  doctor: cmdDoctor,
  drive: () => {
    if (!featureId) {
      console.error("drive requires a feature id");
      process.exitCode = 1;
      return;
    }
    return cmdDrive(featureId);
  },
  cleanup: cmdCleanup,
};

if (!commands[cmd]) {
  console.error("Usage: verify-fmb.mjs <launch|doctor|drive|cleanup> [feature-id]");
  process.exit(1);
}

Promise.resolve(commands[cmd]()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
