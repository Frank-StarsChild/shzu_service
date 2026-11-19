import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { parseMeta } from "@/campus3d/meta";

// PLAN S2：按 glTF 2.0 的 GLB 容器格式手工解析文件头与 JSON 块，
// 校验模型契约（无压缩扩展、B_ 节点、体积）与两张海报。

const DIR = new URL("../../public/campus3d/", import.meta.url);

const buf = readFileSync(new URL("campus.glb", DIR));
const meta = parseMeta(JSON.parse(readFileSync(new URL("campus.meta.json", DIR), "utf-8")));

/** GLB：12 字节文件头 + 若干块；第一块是 JSON。 */
function parseGlbJson(buffer: Buffer): Record<string, unknown> {
  const jsonLen = buffer.readUInt32LE(12);
  const type = buffer.readUInt32LE(16);
  // "JSON" 四字符按小端读出来是 0x4E4F534A
  expect(type).toBe(0x4e4f534a);
  const jsonText = buffer.subarray(20, 20 + jsonLen).toString("utf-8");
  return JSON.parse(jsonText);
}

describe("campus.glb 契约", () => {
  const glb = parseGlbJson(buf);

  it("开头 4 字节是 glTF；版本号是 2", () => {
    expect(buf.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(buf.readUInt32LE(4)).toBe(2);
  });

  it("文件不超过 3 MB（3,145,728 字节）", () => {
    expect(buf.length).toBeLessThanOrEqual(3_145_728);
  });

  it("extensionsRequired 不含 Draco / meshopt / KTX2", () => {
    const required = (glb["extensionsRequired"] as string[] | undefined) ?? [];
    for (const banned of [
      "KHR_draco_mesh_compression",
      "EXT_meshopt_compression",
      "KHR_texture_basisu",
    ]) {
      expect(required, `不允许依赖 ${banned}`).not.toContain(banned);
    }
  });

  it("B_ 节点数等于 meta.buildings 条数；每个 B_ 节点直接带 mesh", () => {
    const nodes = glb["nodes"] as Record<string, unknown>[];
    const bNodes = nodes.filter((n) => typeof n["name"] === "string" && n["name"].startsWith("B_"));
    expect(bNodes.length).toBe(Object.keys(meta.buildings).length);
    for (const n of bNodes) {
      expect(n, `${String(n["name"])} 必须直接带 mesh`).toHaveProperty("mesh");
    }
  });

  it("每个热点的 B_<buildingId> 都能找到", () => {
    const names = new Set(
      (glb["nodes"] as Record<string, unknown>[]).map((n) => String(n["name"] ?? ""))
    );
    for (const h of meta.hotspots) {
      expect(names.has(`B_${h.buildingId}`), `缺少节点 B_${h.buildingId}`).toBe(true);
    }
  });

  it("两张海报存在，各不超过 300 KB", () => {
    for (const f of ["poster-desktop.jpg", "poster-mobile.jpg"]) {
      const st = statSync(new URL(f, DIR));
      expect(st.size, `${f} 超过 300 KB`).toBeLessThanOrEqual(300 * 1024);
    }
  });
});
