import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const staticDir = join(process.cwd(), ".vercel/output/static");
const assetsDir = join(staticDir, "assets");

if (!existsSync(assetsDir)) {
  console.error("[generate-html] assets dir not found at", assetsDir);
  process.exit(1);
}

const files = readdirSync(assetsDir);
const cssFile = files.find((f) => f.startsWith("styles") && f.endsWith(".css")) || files.find((f) => f.endsWith(".css"));

const clientEntryMarker = "TSS_CLIENT_ENTRY";
const entryJsFile = files.find((f) => f.endsWith(".js") && readFileSync(join(assetsDir, f), "utf8").includes(clientEntryMarker));
const mainJsFile = entryJsFile || files.find((f) => f.startsWith("index-") && f.endsWith(".js") && !f.includes("DtqBFgK5") && !f.includes("tTIq2VVr") && !f.includes("U2dGyGLz")) || files.find((f) => f.startsWith("index-") && f.endsWith(".js"));

const cssTag = cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}">` : "";
const jsTag = mainJsFile ? `<script type="module" src="/assets/${mainJsFile}"></script>` : "";

// TanStack Start client entry (hydrateRouter) требует SSR-бутстрап window.$_TSR.
// На статик-хостинге без Nitro-сервера внедряем минимальный бутстрап:
// пустой буфер + "dehydrated" роутер без матчей — клиент доходит до полной SPA-загрузки.
const tsrBootstrap = `<script>
window.$_TSR = {
  buffer: [],
  initialized: false,
  router: { manifest: { routes: {} }, matches: [], lastMatchId: undefined, dehydratedData: undefined },
  h: function () {}
};
</script>`;

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
    ${tsrBootstrap}
  </head>
  <body>
    <div id="root"></div>
    ${jsTag}
  </body>
</html>`;

writeFileSync(join(staticDir, "index.html"), html, "utf8");
console.log("[generate-html] Successfully updated .vercel/output/static/index.html with main script:", mainJsFile);