// PLAN S5 第 9 条：构建产物体积与分包检查。任何一条不满足即非 0 退出。
// 放在 verify 的 build 之后运行。
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

let failed = 0;

function bad(msg) {
  console.error(`[check-bundle] ✗ ${msg}`);
  failed += 1;
}

function ok(msg) {
  console.log(`[check-bundle] ✓ ${msg}`);
}

function gzipSize(buf) {
  return gzipSync(buf).length / 1024; // KB
}

// ---------- dist 产物 ----------
const assetsDir = "dist/assets";
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));

const indexFiles = jsFiles.filter((f) => /^index-.*\.js$/.test(f));
if (indexFiles.length !== 1) {
  bad(`index-*.js 应恰好 1 个（找到 ${indexFiles.length} 个）`);
} else ok(`找到主入口 ${indexFiles[0]}`);

const homeFiles = jsFiles.filter((f) => /^HomeView-.*\.js$/.test(f));
if (homeFiles.length !== 1) {
  bad(`HomeView-*.js 应恰好 1 个（找到 ${homeFiles.length} 个）`);
} else ok(`找到页面块 ${homeFiles[0]}`);

// 1. index-*.js 里没有 WebGLRenderer
if (indexFiles.length === 1) {
  const text = readFileSync(`${assetsDir}/${indexFiles[0]}`, "utf-8");
  if (text.includes("WebGLRenderer")) bad("index-*.js 含有 WebGLRenderer（three 应被懒加载分包）");
  else ok("index-*.js 不含 WebGLRenderer");
}

// 2. index ≤ 44 KB(gzip)，HomeView ≤ 9 KB(gzip)
if (indexFiles.length === 1) {
  const kb = gzipSize(readFileSync(`${assetsDir}/${indexFiles[0]}`));
  if (kb > 44) bad(`index-*.js gzip ${kb.toFixed(1)} KB > 44 KB`);
  else ok(`index-*.js gzip ${kb.toFixed(1)} KB ≤ 44 KB`);
}
if (homeFiles.length === 1) {
  const kb = gzipSize(readFileSync(`${assetsDir}/${homeFiles[0]}`));
  if (kb > 9) bad(`HomeView-*.js gzip ${kb.toFixed(1)} KB > 9 KB`);
  else ok(`HomeView-*.js gzip ${kb.toFixed(1)} KB ≤ 9 KB`);
}

// 3. 含 WebGLRenderer 的块 gzip 合计 ≤ 200 KB
let threeTotal = 0;
let threeChunks = 0;
for (const f of jsFiles) {
  const text = readFileSync(`${assetsDir}/${f}`, "utf-8");
  if (text.includes("WebGLRenderer")) {
    threeTotal += gzipSize(readFileSync(`${assetsDir}/${f}`));
    threeChunks += 1;
  }
}
if (threeChunks === 0) {
  bad("没有任何块包含 WebGLRenderer（scene 应已随动态 import 分包）");
} else if (threeTotal > 200) {
  bad(`含 WebGLRenderer 的块 gzip 合计 ${threeTotal.toFixed(1)} KB > 200 KB（${threeChunks} 块）`);
} else {
  ok(`含 WebGLRenderer 的块共 ${threeChunks} 个，gzip 合计 ${threeTotal.toFixed(1)} KB ≤ 200 KB`);
}

// 4. src/ 里 import three 的文件只有 src/campus3d/scene.ts
const srcFiles = [];
const walkSrc = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${name.name}`;
    if (name.isDirectory()) walkSrc(p);
    else if (/\.(ts|vue)$/.test(name.name)) srcFiles.push(p);
  }
};
walkSrc("src");
const threeImporters = srcFiles.filter((p) => /from\s+["']three/.test(readFileSync(p, "utf-8")));
if (threeImporters.length !== 1 || !threeImporters[0].endsWith("campus3d/scene.ts")) {
  bad(`import three 的文件应只有 src/campus3d/scene.ts（实际：${threeImporters.join(", ") || "无"}）`);
} else ok("src 里只有 campus3d/scene.ts import three");

// 5. tests/ 里没有 .skip( / .only( / .fixme(
const testFiles = [];
const walkTests = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${name.name}`;
    if (name.isDirectory()) walkTests(p);
    else if (/\.spec\.ts$|\.test\.ts$/.test(name.name)) testFiles.push(p);
  }
};
walkTests("tests");
const marked = testFiles.filter((p) => /\.(skip|only)\(|\.fixme\(/.test(readFileSync(p, "utf-8")));
if (marked.length > 0) bad(`测试里含 skip/only/fixme：${marked.join(", ")}`);
else ok(`tests（${testFiles.length} 个文件）没有 skip/only/fixme`);

if (failed > 0) {
  console.error(`[check-bundle] ${failed} 条不满足`);
  process.exit(1);
}
console.log("[check-bundle] 全部通过");
