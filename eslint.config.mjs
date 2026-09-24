import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Conventions the code already keeps, turned into errors so they stay kept.
  // Each had zero violations when added; they lock a state in, not clean one up.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "no-var": "error",
      // The app and the userscript run in someone's browser, where a stray log
      // is noise at best and a leaked calendar at worst.
      "no-console": "error",
    },
  },
  {
    // Server logs are how a failed import is diagnosed at all; the one that
    // exists is careful never to log the private feed URL.
    files: ["src/app/api/**"],
    rules: { "no-console": ["error", { allow: ["error", "warn"] }] },
  },
  {
    // Command-line scripts: printing is their output.
    files: ["scripts/**", "tools/e2e/**"],
    rules: { "no-console": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
