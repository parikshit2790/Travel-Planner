import { mkdirSync, copyFileSync, cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
copyFileSync("index.html", "dist/index.html");
copyFileSync("manifest.webmanifest", "dist/manifest.webmanifest");
copyFileSync("sw.js", "dist/sw.js");
cpSync("src", "dist/src", { recursive: true });
console.log("Built RouteMosaic website into dist/");
