import { spawn } from "node:child_process";

const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter(
  (name) => !process.env[name],
);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(" and ")}.`);
  process.exit(1);
}

const child = spawn("wrangler", ["deploy"], { stdio: "inherit" });
child.on("error", () => process.exit(1));
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
