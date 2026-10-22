import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    // Built declarations are checked separately after packaging.
    ignorePatterns: ["type-tests/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    // `changeset add --empty` writes front matter that Oxfmt rewrites.
    ignorePatterns: [".changeset/*.md"],
  },
});
