import { mkdirSync, copyFileSync, cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
copyFileSync("index.html", "dist/index.html");
copyFileSync("manifest.webmanifest", "dist/manifest.webmanifest");
copyFileSync("sw.js", "dist/sw.js");
copyFileSync("robots.txt", "dist/robots.txt");
copyFileSync("sitemap.xml", "dist/sitemap.xml");
cpSync("src", "dist/src", { recursive: true });
cpSync("public", "dist/public", { recursive: true });
console.log("Built RouteMosaic website into dist/");
