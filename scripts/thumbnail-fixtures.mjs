import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const run = (name, args) =>
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...args,
    `public/fixtures/${name}`,
  ]);
const colors = ["red", "lime", "blue"].flatMap((color) => [
  "-f",
  "lavfi",
  "-i",
  `color=${color}:size=80x40:rate=4:duration=1`,
]);
for (const vfr of [false, true])
  run(vfr ? "markers-vfr.mp4" : "markers.mp4", [
    ...colors,
    "-filter_complex",
    `[0:v][1:v][2:v]concat=n=3:v=1:a=0${vfr ? ",select='not(eq(n,1)+eq(n,5)+eq(n,9))'" : ""}[v]`,
    "-map",
    "[v]",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-x264-params",
    "bframes=2:b-adapt=0:keyint=12",
  ]);
run("two-video.mp4", [
  "-f",
  "lavfi",
  "-i",
  "color=red:size=80x40:rate=4:duration=1",
  "-f",
  "lavfi",
  "-i",
  "color=blue:size=40x80:rate=4:duration=1",
  "-f",
  "lavfi",
  "-i",
  "sine=duration=1",
  "-map",
  "0:v",
  "-map",
  "1:v",
  "-map",
  "2:a",
  "-c:v",
  "libx264",
  "-c:a",
  "aac",
]);
run("geometry.mp4", [
  "-f",
  "lavfi",
  "-i",
  "color=red:size=80x40:rate=4:duration=1",
  "-vf",
  "drawbox=x=40:y=0:w=40:h=40:color=blue:t=fill,drawbox=x=0:y=20:w=40:h=20:color=lime:t=fill,setsar=2",
  "-c:v",
  "libx264",
]);
run("geometry-oriented.mp4", [
  "-display_rotation:v:0",
  "90",
  "-display_hflip:v:0",
  "-i",
  "public/fixtures/geometry.mp4",
  "-c",
  "copy",
]);
run("alpha.webm", [
  "-f",
  "lavfi",
  "-i",
  "color=red:size=80x40:rate=4:duration=1,format=yuva420p,colorchannelmixer=aa=0.5",
  "-c:v",
  "libvpx-vp9",
  "-pix_fmt",
  "yuva420p",
]);
const manifest = JSON.parse(readFileSync("public/fixtures/manifest.json", "utf8"));
const names = [
  "markers.mp4",
  "markers-vfr.mp4",
  "two-video.mp4",
  "geometry.mp4",
  "geometry-oriented.mp4",
  "alpha.webm",
];
manifest.fixtures = [...new Set([...manifest.fixtures, ...names])].sort((a, b) =>
  a.localeCompare(b),
);
manifest.thumbnailFixtures = {
  source: "FFmpeg lavfi generated colors; no third-party media",
  markers:
    "Red, green, blue in consecutive seconds; 4 fps with B frames; VFR omits frames 1, 5 and 9",
  geometry:
    "Red top-left, green bottom-left, blue right half, 80x40 coded, SAR 2:1; oriented copy rotated and flipped",
  alpha: "Half-transparent red VP9; alpha availability depends on decoder",
};
writeFileSync("public/fixtures/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
run("delayed-video.mp4", [
  "-itsoffset",
  "1",
  "-i",
  "public/fixtures/markers.mp4",
  "-f",
  "lavfi",
  "-i",
  "sine=duration=5",
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
]);
manifest.fixtures = [...new Set([...manifest.fixtures, "delayed-video.mp4"])].sort((a, b) =>
  a.localeCompare(b),
);
manifest.thumbnailFixtures.delayed = "Video covers [1,4), audio continues to 5 seconds";
writeFileSync("public/fixtures/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
