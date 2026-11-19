import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// PLAN S1：在现有 vite.config.ts 基础上合并（@ 别名可用），
// 只收 tests/unit/**/*.test.ts，环境 node。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  })
);
