import { readdirSync, writeFileSync, existsSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const cwd = process.cwd();
const backupAssetsDir = join(cwd, ".vercel/assets_backup");
const staticDir = join(cwd, ".vercel/output/static");
const targetAssetsDir = join(staticDir, "assets");

const mode = process.argv[2];

if (mode === "backup") {
  const currentAssetsDir = join(staticDir, "assets");
  if (existsSync(currentAssetsDir)) {
    cpSync(currentAssetsDir, backupAssetsDir, { recursive: true });
    console.log("[generate-html] Backed up assets to", backupAssetsDir);
  }
} else {
  if (existsSync(backupAssetsDir)) {
    if (!existsSync(staticDir)) mkdirSync(staticDir, { recursive: true });
    cpSync(backupAssetsDir, targetAssetsDir, { recursive: true });
    console.log("[generate-html] Restored assets to", targetAssetsDir);
  }

  if (!existsSync(targetAssetsDir)) {
    console.error("[generate-html] target assets dir not found at", targetAssetsDir);
    process.exit(1);
  }

  const files = readdirSync(targetAssetsDir);
  const cssFile = files.find((f) => f.startsWith("styles") && f.endsWith(".css")) || files.find((f) => f.endsWith(".css"));
  const mainJsFile = files.find((f) => f.startsWith("index-") && f.endsWith(".js") && !f.includes("DtqBFgK5") && !f.includes("tTIq2VVr") && !f.includes("U2dGyGLz")) || files.find((f) => f.startsWith("index-") && f.endsWith(".js"));

  const cssTag = cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}">` : "";
  const jsTag = mainJsFile ? `<script type="module" src="/assets/${mainJsFile}"></script>` : "";

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
    ${jsTag}
  </body>
</html>`;

  writeFileSync(join(staticDir, "index.html"), html, "utf8");
  console.log("[generate-html] Successfully generated .vercel/output/static/index.html with script:", mainJsFile);
}
