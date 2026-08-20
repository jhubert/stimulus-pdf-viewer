import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      reporter: ["text", "html"]
    }
  }
})
