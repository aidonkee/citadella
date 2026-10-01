// Wires Vercel __server to dispatch /_serverFn/* to the TanStack Start SSR entry
// and copies runtime deps the SPA build omits from the function's node_modules.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), ".vercel/output");
const funcDir = join(out, "functions", "__server.func");
const indexMjs = join(funcDir, "index.mjs");
if (!existsSync(indexMjs)) throw new Error("no " + indexMjs);

// 1) dispatch patch (idempotent)
let src = readFileSync(indexMjs, "utf8");
const MARK = '__u.pathname.startsWith("/_serverFn/")';
if (!src.includes(MARK)) {
  const OLD = "const vercel_web = { fetch(req, context) {\n  const isrURL = isrRouteRewrite(req.url, req.headers.get(\"x-now-route-matches\"));";
  const NEW = [
    'const vercel_web = { async fetch(req, context) {',
    "  try {",
    "    const __u = new URL(req.url);",
    '    if (__u.pathname.startsWith("/_serverFn/")) {',
    "      req.runtime ??= { name: \"vercel\" };",
    "      req.runtime.vercel = { context };",
    "      req.waitUntil = context?.waitUntil;",
    "      let ip;",
    "      Object.defineProperty(req, \"ip\", { get() {",
    "        const h = req.headers.get(\"x-forwarded-for\");",
    "        return ip ??= h?.split(\",\").shift()?.trim();",
    "      } });",
    '      const __ssr = await import("./_ssr/index.mjs");',
    "      return await __ssr.default.fetch(req, {}, { waitUntil: context?.waitUntil });",
    "    }",
    "  } catch (e) {",
    "    console.error(\"[__server] /_serverFn dispatch error:\", e);",
    "    return new Response(\"Internal Server Error\", { status: 500, headers: { \"content-type\": \"text/plain\" } });",
    "  }",
    '  const isrURL = isrRouteRewrite(req.url, req.headers.get("x-now-route-matches"));'
  ].join("\n");
  if (!src.includes(OLD)) throw new Error("index.mjs anchor not found — build shape changed, update patch-serverfn.mjs");
  src = src.replace(OLD, NEW);
  writeFileSync(indexMjs, src, "utf8");
  console.log("[patch-serverfn] index.mjs: /_serverFn dispatch wired");
} else {
  console.log("[patch-serverfn] index.mjs: already patched");
}

// 2) copy runtime deps into the function (SPA build ships only tslib there)
const dest = join(funcDir, "node_modules");
const pkgs = ["ws", "iceberg-js", "tslib", "@supabase/supabase-js", "@supabase/auth-js", "@supabase/functions-js", "@supabase/postgrest-js", "@supabase/realtime-js", "@supabase/storage-js", "@supabase/phoenix"];
for (const p of pkgs) {
  const from = join(process.cwd(), "node_modules", p);
  const to = join(dest, p);
  if (!existsSync(from)) { console.warn("[patch-serverfn] skip (not in project):", p); continue; }
  if (p.startsWith("@")) mkdirSync(join(dest, p.split("/")[0]), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
console.log("[patch-serverfn] copied packages:", pkgs.join(", "));

// allow long-running server functions (voice STT + AI queries can take 30-60s)
const vcCfg = join(funcDir, ".vc-config.json");
if (existsSync(vcCfg)) {
  const vcJson = JSON.parse(readFileSync(vcCfg, "utf8"));
  vcJson.maxDuration = 60;
  delete vcJson.shouldAddHelpers;
  writeFileSync(vcCfg, JSON.stringify(vcJson, null, 2) + "\n", "utf8");
  console.log("[patch-serverfn] .vc-config.json: maxDuration=60");
}

// base64-arraybuffer is required by supabase storage but not installed here — provide a faithful tiny impl
const b64 = join(dest, "base64-arraybuffer");
rmSync(b64, { recursive: true, force: true });
mkdirSync(b64, { recursive: true });
writeFileSync(join(b64, "package.json"), JSON.stringify({ name: "base64-arraybuffer", version: "1.0.2", type: "module", main: "index.js", module: "index.js" }, null, 2));
writeFileSync(join(b64, "index.js"), 'export function toBase64(input) {\n  const buf = input instanceof ArrayBuffer ? new Uint8Array(input) : input;\n  return Buffer.from(buf).toString("base64");\n}\nexport function fromBase64(str) {\n  const bytes = Buffer.from(str, "base64");\n  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);\n}\n');
console.log("[patch-serverfn] base64-arraybuffer: provided");
