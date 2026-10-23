import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), "fluent-mediabunny-4h-8k-stereo.wav");

/** Real 4-hour, 8 kHz stereo PCM. Regenerated with ffmpeg; not a committed fixture. */
export function longStereoWav(): string {
  if (!reusable(file))
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=8000:duration=14400",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=8000:duration=14400",
      "-filter_complex",
      "[0:a][1:a]amerge=inputs=2",
      "-c:a",
      "pcm_s16le",
      file,
    ]);
  return file;
}

function reusable(path: string): boolean {
  if (!existsSync(path) || statSync(path).size < 400_000_000) return false;
  const probed = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels:format=duration",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    ),
  ) as {
    streams?: { sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const stream = probed.streams?.[0];
  return (
    stream?.sample_rate === "8000" &&
    stream.channels === 2 &&
    Number(probed.format?.duration) >= 14399
  );
}
