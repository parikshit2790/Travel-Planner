import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FUNCTION_LIMIT = 11;
const outputFunctionsDir = join(process.cwd(), ".vercel", "output", "functions");

const functions = existsSync(outputFunctionsDir)
  ? listVercelOutputFunctions(outputFunctionsDir)
  : listSourceFunctions(process.cwd());

if (functions.length > FUNCTION_LIMIT) {
  console.error(`Vercel function count ${functions.length} exceeds limit ${FUNCTION_LIMIT}.`);
  functions.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Vercel function count OK: ${functions.length}/${FUNCTION_LIMIT}`);
functions.forEach((item) => console.log(`- ${item}`));

function listVercelOutputFunctions(dir) {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".func"))
    .sort()
    .map((entry) => `.vercel/output/functions/${entry}`);
}

function listSourceFunctions(root) {
  const candidates = [
    join(root, "api"),
    join(root, "pages", "api"),
    join(root, "src", "api"),
    join(root, "app", "api"),
    join(root, "functions")
  ];
  return candidates.flatMap((dir) => existsSync(dir) ? listRouteFiles(dir, root) : []).sort();
}

function listRouteFiles(dir, root) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry.startsWith("_")) return [];
      return listRouteFiles(path, root);
    }
    if (!/\.(js|mjs|cjs|ts|tsx)$/.test(entry)) return [];
    return [relative(root, path)];
  });
}
