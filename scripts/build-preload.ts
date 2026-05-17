import { build } from "esbuild";

await build({
  entryPoints: ["electron/preload/index.ts"],
  outfile: "dist-electron/electron/preload/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "silent"
});
