import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
  },
  vite: {
    environments: {
      nitro: {
        build: {
          outDir: ".vercel/output/functions/__server.func",
        },
      },
    },
  },
});