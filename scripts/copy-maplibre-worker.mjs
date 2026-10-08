#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const mapLibrePackage = require.resolve("maplibre-gl/package.json");
const sourceDirectory = path.join(path.dirname(mapLibrePackage), "dist");
const outputDirectory = path.join(process.cwd(), "public", "maplibre");

mkdirSync(outputDirectory, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(sourceDirectory, filename), path.join(outputDirectory, filename));
}

console.log("Copied the installed MapLibre worker and shared module into public/maplibre.");
