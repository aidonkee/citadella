#!/usr/bin/env node
// Patches nitro's vite plugin to safely handle missing `this.meta` context.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// 1. Patch nitro vite.mjs
const nitroVite = join(root, "node_modules/nitro/dist/vite.mjs");
try {
  const content = readFileSync(nitroVite, "utf8");
  const patched = content.replace(
    "ctx._isRolldown = !!this.meta.rolldownVersion;",
    "ctx._isRolldown = !!this?.meta?.rolldownVersion;"
  );
  if (content === patched) {
    console.log("[postinstall] nitro patch already applied or not needed.");
  } else {
    writeFileSync(nitroVite, patched, "utf8");
    console.log("[postinstall] nitro vite.mjs patched successfully.");
  }
} catch (e) {
  console.warn("[postinstall] Could not patch nitro:", e.message);
}
