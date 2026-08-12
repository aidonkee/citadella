import { readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const distDir = join(process.cwd(), "dist");
const assetsDir = join(distDir, "assets");

if (!existsSync(assetsDir)) {
  console.error("[generate-html] assets dir not found");
  process.exit(1);
}

const files = readdirSync(assetsDir);
const cssFile = files.find((f) => f.startsWith("styles") && f.endsWith(".css")) || files.find((f) => f.endsWith(".css"));
const mainJsFile = files.find((f) => f.startsWith("index-") && f.endsWith(".js") && !f.includes("functions"));
const routeJsFile = files.find((f) => f.startsWith("route-") && f.endsWith(".js"));

const cssTag = cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}">` : "";
const jsTag = mainJsFile ? `<script type="module" src="/assets/${mainJsFile}"></script>` : "";
const routeTag = routeJsFile ? `<script type="module" src="/assets/${routeJsFile}"></script>` : "";

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
    ${routeTag}
    ${jsTag}
  </body>
</html>`;

writeFileSync(join(distDir, "index.html"), html, "utf8");
console.log("[generate-html] Successfully generated dist/index.html");
