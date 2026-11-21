// W1 验证：对 packs.json 里的每个包，从 campus.glb 的 JSON 块读节点表，
// 核对 H_/Z_/P_pin 与 B_ 数量（用循环写，不把七个包各抄一遍）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePackIndex, type PackIndex } from "@/stage/packs";
import { parseMeta, type CampusMeta } from "@/campus3d/meta";

const PUB = resolve(__dirname, "../../public/campus3d");

/** 读取 glb 的 JSON 块（头 12 字节之后是 JSON 长度 + 类型 + JSON 正文）。 */
function glbJson(dir: string): any {
  const buf = readFileSync(resolve(PUB, `${dir}/campus.glb`));
  const jsonLen = buf.readUInt32LE(12);
  const text = buf.subarray(20, 20 + jsonLen).toString("utf-8");
  return JSON.parse(text);
}

const index: PackIndex = parsePackIndex(
  JSON.parse(readFileSync(resolve(PUB, "packs.json"), "utf-8"))
);

for (const pack of index.packs) {
  describe(`${pack.id}/campus.glb 的节点（W1，七包循环）`, () => {
    const meta: CampusMeta = parseMeta(
      JSON.parse(readFileSync(resolve(PUB, `${pack.id}/campus.meta.json`), "utf-8"))
    );
    const glb = glbJson(pack.id);
    const nodes = glb.nodes as { name?: string; mesh?: number; scale?: number[] }[];

    it("meta.shells 的每个楼号都有 H_ 节点：无 mesh、缩放为 0", () => {
      for (const id of meta.shells ?? []) {
        const node = nodes.find((n) => n.name === `H_${id}`);
        expect(node, `${pack.id}：H_${id} 节点存在`).toBeTruthy();
        expect(node!.mesh).toBeUndefined();
        expect(node!.scale).toEqual([0, 0, 0]);
      }
    });

    it("每个带 node 的片区都有同名节点，缩放为 0", () => {
      for (const z of meta.zones ?? []) {
        if (!z.node) continue;
        const node = nodes.find((n) => n.name === z.node);
        expect(node, `${pack.id}：${z.node} 节点存在`).toBeTruthy();
        expect(node!.mesh).toBeUndefined();
        expect(node!.scale).toEqual([0, 0, 0]);
      }
    });

    it("有 look.pin.node 名的节点：无 mesh、缩放为 0", () => {
      const pinName = meta.look.pin?.node;
      expect(pinName, `${pack.id}：meta.look.pin.node 存在`).toBeTruthy();
      const node = nodes.find((n) => n.name === pinName);
      expect(node, `${pack.id}：${pinName} 节点存在`).toBeTruthy();
      expect(node!.mesh).toBeUndefined();
      expect(node!.scale).toEqual([0, 0, 0]);
    });

    it(`名字以 B_ 开头的节点恰好 ${Object.keys(meta.buildings).length} 个`, () => {
      const count = nodes.filter((n) => (n.name ?? "").startsWith("B_")).length;
      expect(count).toBe(Object.keys(meta.buildings).length);
    });
  });
}
