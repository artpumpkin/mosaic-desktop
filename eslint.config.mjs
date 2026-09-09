import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Compiler is not enabled. Keep its migration diagnostics visible
  // as warnings while conventional hook correctness remains enforced.
  { rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn", "react-hooks/purity": "warn" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "**/dist-js/**",
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
