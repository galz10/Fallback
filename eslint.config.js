import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "dist-electron/**", "node_modules/**", "release/**", "ui-mocks/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "off",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "node:*", "../../electron/**", "../electron/**", "electron/main/**", "electron/preload/**"],
              message: "Renderer code must use the preload FallbackApi contract instead of Electron, Node, or main-process modules."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["electron/preload/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../src/renderer/**", "../renderer/**", "src/renderer/**"],
              message: "Preload code must not import renderer modules."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "node:*", "../../electron/**", "../renderer/**", "src/renderer/**"],
              message: "Shared modules must stay runtime-neutral and avoid Electron, Node-only, and renderer modules."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        TextDecoder: "readonly",
        URL: "readonly",
        process: "readonly"
      }
    }
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  }
);
