import { readFileSync } from "node:fs";
import typescript from "@rollup/plugin-typescript";
import preserveDirectives from "rollup-plugin-preserve-directives";

// Bake the guest-js package version into the bundle. Source code refers
// to the literal token `__PLAYER_VERSION__`; this replaces it with the
// real version so the running app can display which JS build is live
// (alongside the native plugin version returned by `attach`). Runs after
// the TypeScript transform — the token survives compilation as a plain
// string literal, so a post-TS text replace is all that's needed.
const pkgVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

const injectVersion = {
  name: "inject-player-version",
  transform(code) {
    if (!code.includes("__PLAYER_VERSION__")) return null;
    return {
      code: code.replace(/__PLAYER_VERSION__/g, pkgVersion),
      map: null,
    };
  },
};

// Two entry points in ONE module graph per format. Building both
// `index` (core) and `react/index` (UI) together — rather than as two
// separate rollup configs — means the shared modules (`mpv`, `logger`,
// `playerDebug`) are emitted ONCE and imported by both entries. Two
// separate configs would each bundle their own copy of `mpv.ts`,
// producing two `mpv` singletons (attach state / subscribers would
// diverge between a `tauri-plugin-mpv-api` import and a
// `tauri-plugin-mpv-api/react` import). preserveModulesRoot: "guest-js"
// keeps the output tree mirroring the source.
const input = {
  index: "guest-js/index.ts",
  "react/index": "guest-js/react/index.ts",
};

// Resolve to the consumer's copies — never bundle these.
const external = [
  /^@tauri-apps\/api/,
  "react",
  "react-dom",
  "react/jsx-runtime",
  "lucide-react",
  "clsx",
];

// preserveModules + per-file "use client" directives make rollup emit a
// MODULE_LEVEL_DIRECTIVE warning per file; rollup-plugin-preserve-
// directives re-emits them correctly, so silence the noise.
const onwarn = (warning, warn) => {
  if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
  warn(warning);
};

export default [
  // ESM build + type declarations.
  {
    input,
    output: {
      dir: "dist-js",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "guest-js",
      entryFileNames: "[name].js",
    },
    external,
    onwarn,
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: true,
        declarationDir: "dist-js",
        jsx: "react-jsx",
        outDir: "dist-js",
      }),
      injectVersion,
      preserveDirectives(),
    ],
  },
  // CJS build (no declarations — emitted once by the ESM build).
  {
    input,
    output: {
      dir: "dist-js",
      format: "cjs",
      preserveModules: true,
      preserveModulesRoot: "guest-js",
      entryFileNames: "[name].cjs",
    },
    external,
    onwarn,
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        jsx: "react-jsx",
        outDir: "dist-js",
      }),
      injectVersion,
      preserveDirectives(),
    ],
  },
];
