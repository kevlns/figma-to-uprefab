// Copyright © 2026 Vant <sl_kevln@163.com>
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" }),
});
