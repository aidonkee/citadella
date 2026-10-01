import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), ".vercel/output");
const cfg = join(out, "config.json");
if (!existsSync(cfg)) throw new Error("no .vercel/output/config.json");

// Static SPA for pages (works) + /_serverFn -> __server (server functions)
const c = JSON.parse(readFileSync(cfg, "utf8"));
c.routes = [
  { headers: { "cache-control": "public, max-age=31536000, immutable" }, src: "/assets/(.*)" },
  { handle: "filesystem" },
  { src: "^/_serverFn/.*", dest: "/__server" },
  { src: "/(.*)", dest: "/index.html" }
];
writeFileSync(cfg, JSON.stringify(c, null, 2));
console.log("hybrid routes set:", JSON.stringify(c.routes));
