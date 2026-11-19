import { defineConfig } from "@playwright/test";

// PLAN S1：e2e 测的是 dist/ 构建产物（test:e2e 先 build）。
// 无头浏览器是软件渲染（swiftshader），后续测 3D 的用例须用 /?3d=1 打开（PLAN S4 注意）。
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
