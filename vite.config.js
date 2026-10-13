import { defineConfig } from "vite";

export default defineConfig({
  // Ensure every JSX file can reference React (memo, fragments, createElement).
  // Without this, production builds can throw "React is not defined" at runtime.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
