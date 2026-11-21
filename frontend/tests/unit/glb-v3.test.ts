// W1 验证：从 all/campus.glb 的 JSON 块读取节点表，核对 H_/Z_/P_pin 与 B_ 数量。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMeta } from "@/campus3d/meta";

const PUB = resolve(__dirname, "../../public/campus3d");

/** 读取 glb 的 JSON 块（头 12 字节之后是 JSON 长度 + 类型 + JSON 正文）。 */
function glbJson(pack: string): any {
  const buf = readFileSync(resolve(PUB, `${pack}/campus.glb`));
  const jsonLen = buf.readUInt32LE(12);
  const text = buf.subarray(20, 20 + jsonLen).toString("utf-8");
  return JSON.parse(text);
}

function rootNodes(nodes: any[]): any[] {
  // glTF 导出的 scene 根；节点表里名字唯一，这里按 nodes 数组本身枚举根级组
  return nodes;
}

describe("all/campus.glb 的节点（W1）", () => {
  const meta = parseMeta(JSON.parse(readFileSync(resolve(PUB, "all/campus.meta.json"), "utf-8")));
  const glb = glbJson("all");
  const nodes = rootNodes(glb.nodes) as { name?: string; mesh?: number; scale?: number[] }[];

  it("meta.shells 的每个楼号都有 H_ 节点：无 mesh、缩放为 0", () => {
    for (const id of meta.shells ?? []) {
      const node = nodes.find((n) => n.name === `H_${id}`);
      expect(node, `H_${id} 节点存在`).toBeTruthy();
      expect(node!.mesh).toBeUndefined();
      expect(node!.scale).toEqual([0, 0, 0]);
    }
  });

  it("每个带 node 的片区都有同名节点，缩放为 0", () => {
    for (const z of meta.zones ?? []) {
      if (!z.node) continue;
      const node = nodes.find((n) => n.name === z.node);
      expect(node, `${z.node} 节点存在`).toBeTruthy();
      expect(node!.scale).toEqual([0, 0, 0]);
    }
  });

  it("有 P_pin 节点，缩放为 0", () => {
    const node = nodes.find((n) => n.name === meta.look.pin?.node);
    expect(node, "P_pin 节点存在").toBeTruthy();
    expect(node!.scale).toEqual([0, 0, 0]);
  });

  it("名字以 B_ 开头的节点恰好 303 个", () => {
    expect(nodes.filter((n) => (n.name ?? "").startsWith("B_")).length).toBe(303);
  });
});

describe("jjs/campus.glb 的节点（W1）", () => {
  const meta = parseMeta(JSON.parse(readFileSync(resolve(PUB, "jjs/campus.meta.json"), "utf-8")));
  const glb = glbJson("jjs");
  const nodes = glb.nodes as { name?: string; mesh?: number; scale?: number[] }[];

  it("shells 的每个楼号都有 H_ 节点且缩放为 0", () => {
    for (const id of meta.shells ?? []) {
      const node = nodes.find((n) => n.name === `H_${id}`);
      expect(node, `H_${id} 节点存在`).toBeTruthy();
      expect(node!.scale).toEqual([0, 0, 0]);
    }
  });

  it("名字以 B_ 开头的节点恰好 19 个", () => {
    expect(nodes.filter((n) => (n.name ?? "").startsWith("B_")).length).toBe(19);
  });
});
