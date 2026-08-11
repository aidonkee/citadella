#!/usr/bin/env node
// Patches nitro's vite plugin to safely handle missing `this.meta` context.
// Also ensures the oxc-parser native binding is present for darwin-arm64.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
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

// 2. Ensure oxc-parser native binding for darwin-arm64 is installed
const bindingPath = join(root, "node_modules/@oxc-parser/binding-darwin-arm64");
if (process.platform === "darwin" && process.arch === "arm64" && !existsSync(bindingPath)) {
  try {
    console.log("[postinstall] Installing @oxc-parser/binding-darwin-arm64...");
    execSync("npm install @oxc-parser/binding-darwin-arm64@0.120.0 --legacy-peer-deps --no-save", {
      cwd: root,
      stdio: "inherit",
    });
    console.log("[postinstall] oxc-parser binding installed.");
  } catch (e) {
    console.warn("[postinstall] Could not install oxc-parser binding:", e.message);
  }
} else if (existsSync(bindingPath)) {
  console.log("[postinstall] oxc-parser binding already present.");
}

