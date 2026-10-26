import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
mkdirSync("public/fixtures", { recursive: true });
const run = (name, args) =>
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...args,
    `public/fixtures/${name}`,
  ]);
const video = ["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=15:duration=2"];
const audio = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2"];
run("av.mp4", [
  ...video,
  ...audio,
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-metadata",
  "title=\u6e90\u6807\u9898",
  "-metadata",
  "artist=fixture",
]);
run("silent.mp4", [...video, "-c:v", "libx264"]);
run("audio.wav", [...audio, "-c:a", "pcm_s16le"]);
run("audio.mp3", [...audio, "-c:a", "libmp3lame"]);
run("vorbis.ogg", [...audio, "-c:a", "libvorbis"]);
run("av.webm", [...video, ...audio, "-c:v", "libvpx-vp9", "-c:a", "libopus"]);
run("multi.mp4", [
  ...video,
  ...audio,
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-map",
  "1:a",
  "-c:v",
  "libx264",
  "-c:a",
  "aac",
]);
run("hevc.mp4", [...video, "-c:v", "libx265", "-tag:v", "hvc1", "-x265-params", "log-level=error"]);
run("rotated.mp4", ["-display_rotation:v:0", "90", "-i", "public/fixtures/av.mp4", "-c", "copy"]);
run("offset.mp4", ["-i", "public/fixtures/av.mp4", "-c", "copy", "-output_ts_offset", "5"]);
run("vfr.mp4", [
  ...video,
  ...audio,
  "-vf",
  "select='not(mod(n,3)) + not(mod(n,5))'",
  "-fps_mode",
  "vfr",
  "-c:v",
  "libx264",
  "-c:a",
  "aac",
]);
run("odd.webm", [
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=161x121:rate=10:duration=1",
  "-c:v",
  "libvpx-vp9",
  "-pix_fmt",
  "yuv444p",
]);
run("rate.wav", ["-f", "lavfi", "-i", "sine=sample_rate=12345:duration=1", "-c:a", "pcm_s16le"]);
writeFileSync("public/fixtures/corrupt.mp4", "not a media file");
writeFileSync(
  "public/fixtures/manifest.json",
  JSON.stringify(
    {
      source:
        "Generated locally with FFmpeg lavfi testsrc/testsrc2 and sine. No third-party media.",
      baseline:
        "2 seconds, 160x120, 15 fps, 440 Hz mono at 44100 Hz; exceptions visible in scripts/fixtures.mjs",
      fixtures: [
        "av.mp4",
        "silent.mp4",
        "audio.wav",
        "audio.mp3",
        "av.webm",
        "multi.mp4",
        "hevc.mp4",
        "rotated.mp4",
        "offset.mp4",
        "vfr.mp4",
        "odd.webm",
        "rate.wav",
        "corrupt.mp4",
      ],
    },
    null,
    2,
  ),
);
run("long.mp4", [
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=24:duration=30",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=30",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-c:a",
  "aac",
]);

for (const size of ["160x120", "96x64"])
  run(`${size}.h264`, [
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${size}:rate=15:duration=1`,
    "-c:v",
    "libx264",
    "-f",
    "h264",
  ]);
writeFileSync(
  "public/fixtures/dynamic.h264",
  Buffer.concat(["160x120", "96x64"].map((s) => readFileSync(`public/fixtures/${s}.h264`))),
);
run("dynamic.mp4", [
  "-fflags",
  "+genpts",
  "-r",
  "15",
  "-i",
  "public/fixtures/dynamic.h264",
  "-c",
  "copy",
]);
for (const size of ["160x120", "96x64", "dynamic"]) unlinkSync(`public/fixtures/${size}.h264`);
run("artwork-front.jpg", ["-f", "lavfi", "-i", "color=c=red:s=2x2", "-frames:v", "1", "-q:v", "8"]);
run("artwork-back.png", ["-f", "lavfi", "-i", "color=c=blue:s=2x2", "-frames:v", "1"]);
run("artwork.mp3", [
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=8000:duration=0.1",
  "-i",
  "public/fixtures/artwork-back.png",
  "-i",
  "public/fixtures/artwork-front.jpg",
  "-map",
  "0:a",
  "-map",
  "1:v",
  "-map",
  "2:v",
  "-c:a",
  "libmp3lame",
  "-b:a",
  "8k",
  "-c:v",
  "copy",
  "-id3v2_version",
  "3",
  "-metadata:s:v:0",
  "comment=Cover (back)",
  "-metadata:s:v:1",
  "comment=Cover (front)",
  "-disposition:v:0",
  "attached_pic",
  "-disposition:v:1",
  "attached_pic",
]);
unlinkSync("public/fixtures/artwork-front.jpg");
unlinkSync("public/fixtures/artwork-back.png");
const manifest = JSON.parse(readFileSync("public/fixtures/manifest.json", "utf8"));
manifest.fixtures = readdirSync("public/fixtures").filter((name) => name !== "manifest.json");
manifest.exceptions = {
  "long.mp4": "30 seconds, 640x360, 24 fps",
  "dynamic.mp4": "Two 1-second AVC segments: 160x120 then 96x64",
  "offset.mp4": "Input timestamp shifted by +5 seconds",
  "rotated.mp4": "90 degree rotation metadata",
  "vfr.mp4": "Frame selection retains frame indices divisible by 3 or 5",
  "odd.webm": "161x121, one second, VP9 yuv444p",
  "rate.wav": "12345 Hz mono, one second",
  "artwork.mp3": "Short 8 kHz mono sine with a PNG back cover before a JPEG front cover",
};
writeFileSync("public/fixtures/manifest.json", JSON.stringify(manifest, null, 2));

const rotated = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "stream_side_data",
      "-of",
      "json",
      "public/fixtures/rotated.mp4",
    ],
    { encoding: "utf8" },
  ),
);
if (rotated.streams[0].side_data_list?.[0]?.rotation !== 90)
  throw new Error("Rotation fixture lacks its display matrix.");

await import("./thumbnail-fixtures.mjs");
