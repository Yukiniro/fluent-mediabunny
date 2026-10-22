#!/usr/bin/env node
/**
 * Exhaustive finite-state check of the cancel-vs-commit barrier.
 *
 * Models the contracts in:
 *   src/scope.ts  (Scope.abort ignores phase==="committing"; Scope.commit sets it)
 *   src/target.ts (OutputSink.abort no-ops while committing; only commit() closes)
 *
 * Usage:
 *   node model/commit_barrier_check.mjs              # expect PASS
 *   node model/commit_barrier_check.mjs --broken      # expect FAIL (removed committing guard)
 *
 * Exit 0 = property holds for all explored states.
 * Exit 1 = counterexample found (printed as a step sequence).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const broken = process.argv.includes("--broken");
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @typedef {"preparing"|"processing"|"committing"|"finished"} Phase */
/** @typedef {"none"|"open"|"aborted"|"closed"} Stream */

/**
 * One step of the library lifecycle (indivisible where the code is).
 * Names mirror Scope / OutputSink methods.
 */
function enabled(state) {
  const acts = [];
  if (state.phase === "preparing" && state.stream === "none") acts.push("open");
  if (state.stream === "open" && state.phase !== "committing" && state.phase !== "finished")
    acts.push("write");
  if (
    (state.phase === "preparing" || state.phase === "processing") &&
    state.stream !== "none" &&
    (!state.failed || broken)
  )
    acts.push("beginCommit");
  if (state.phase === "committing" && state.stream === "open") acts.push("close");
  if (!state.signalAborted && state.phase !== "finished") acts.push("userAbort");
  if (state.failed && state.phase !== "finished" && state.stream === "open") acts.push("runAbort");
  if (
    (state.failed || state.phase === "committing") &&
    state.stream !== "open" &&
    state.phase !== "finished"
  )
    acts.push("finish");
  if (state.phase === "committing" && state.stream === "closed") acts.push("finish");
  return acts;
}

function step(state, action) {
  const next = { ...state, trace: state.trace.concat(action) };
  switch (action) {
    case "open":
      next.stream = "open";
      next.phase = "processing";
      return next;
    case "write":
      return next;
    case "beginCommit":
      // Scope.commit(): check() then phase = committing
      // Broken variant: still enter commit after a pre-commit failure (would close the file).
      if (next.failed && !broken) return null;
      next.phase = "committing";
      return next;
    case "close":
      // OutputSink.commit() awaits stream.close() only after Scope.commit()
      next.stream = "closed";
      return next;
    case "userAbort":
      next.signalAborted = true;
      // Scope.abort: if ended || phase === committing → return (abort does not undo commit)
      if (next.phase === "committing") return next;
      next.failed = true;
      return next;
    case "runAbort":
      // OutputSink.abort: if scope.phase === committing → return
      if (next.phase === "committing") return next;
      if (next.stream === "open") next.stream = "aborted";
      return next;
    case "finish":
      next.phase = "finished";
      return next;
    default:
      throw new Error(action);
  }
}

/** Harm: cancel before commit must not close the real file. */
function violates(state) {
  const canceledBeforeCommit =
    state.trace.includes("userAbort") &&
    state.trace.indexOf("userAbort") <
      (state.trace.includes("beginCommit") ? state.trace.indexOf("beginCommit") : Infinity);
  if (canceledBeforeCommit && state.stream === "closed") return "cancel-before-commit-closed-file";
  // Post-commit abort must not flip a successful close into aborted without close
  if (
    state.trace.includes("beginCommit") &&
    state.trace.includes("close") &&
    state.stream === "aborted"
  )
    return "post-commit-stream-aborted-after-close";
  return null;
}

function key(state) {
  return JSON.stringify({
    phase: state.phase,
    stream: state.stream,
    signalAborted: state.signalAborted,
    failed: state.failed,
  });
}

function explore() {
  const initial = {
    phase: "preparing",
    stream: "none",
    signalAborted: false,
    failed: false,
    trace: [],
  };
  const queue = [initial];
  const seen = new Set([key(initial)]);
  let visited = 0;
  const terminals = [];

  while (queue.length) {
    const state = queue.shift();
    visited++;
    const reason = violates(state);
    if (reason) {
      return {
        ok: false,
        reason,
        counterexample: state.trace,
        state: { phase: state.phase, stream: state.stream, failed: state.failed },
        visited,
        broken,
      };
    }
    const acts = enabled(state);
    if (acts.length === 0) terminals.push(state.trace);
    for (const action of acts) {
      const next = step(state, action);
      if (!next) continue;
      const k = key(next);
      // Bound traces to avoid unbounded write loops: allow at most 3 writes
      if (next.trace.filter((a) => a === "write").length > 3) continue;
      if (!seen.has(k + "|" + next.trace.join(","))) {
        // Also explore distinct traces with same key briefly — use key only for BFS saturation
        if (!seen.has(k) || next.trace.length <= 8) {
          seen.add(k);
          seen.add(k + "|" + next.trace.join(","));
          queue.push(next);
        }
      }
    }
  }

  return {
    ok: true,
    visited,
    terminalTraces: terminals.length,
    broken,
    property:
      "A userAbort that occurs before beginCommit never ends with stream===closed; after close the stream is not aborted.",
  };
}

const report = explore();
const outDir = resolve(__dirname, "../../../artifacts/verify-commit-barrier");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, broken ? "broken-report.json" : "report.json");
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
