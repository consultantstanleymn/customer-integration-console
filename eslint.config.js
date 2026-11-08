import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "test-results/**", "playwright-report/**", "web/next-env.d.ts"] },
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
);
