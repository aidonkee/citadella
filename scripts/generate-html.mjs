import { readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const distDir = join(process.cwd(), "dist");
const assetsDir = join(distDir, "assets");

if (!existsSync(assetsDir)) {
  console.error("[generate-html] assets dir not found");
  process.exit(1);
}

const files = readdirSync(assetsDir);
const cssFile = files.find((f) => f.startsWith("styles") && f.endsWith(".css")) || files.find((f) => f.endsWith(".css"));

// Find all main index / entry JS files sorted by size descending
const jsFiles = files
  .filter((f) => f.endsWith(".js") && (f.startsWith("index-") || f.startsWith("route-")))
  .map((f) => ({ name: f, size: statSync(join(assetsDir, f)).size }))
  .sort((a, b) => b.size - a.size);

// Top 3 entry chunks (vendor 793kb, router 118kb, route 14kb)
const scriptTags = jsFiles
  .slice(0, 3)
  .map((f) => `<script type="module" src="/assets/${f.name}"></script>`)
  .join("\n    ");

const cssTag = cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}">` : "";

const html = `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nerva — Нервная система предприятия</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
    ${cssTag}
  </head>
  <body>
    <div id="root"></div>
    ${scriptTags}
  </body>
</html>`;

writeFileSync(join(distDir, "index.html"), html, "utf8");
console.log("[generate-html] Successfully generated dist/index.html with scripts:", jsFiles.slice(0, 3).map((f) => f.name));
