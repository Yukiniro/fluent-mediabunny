import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocs } from "./invariants.ts";

const root = dirname(fileURLToPath(import.meta.url));
const problems = checkDocs(join(root, "docs"), join(root, "../src/types.ts"));
if (problems.length === 0) process.exit(0);
for (const problem of problems) console.error(problem);
process.exit(1);
