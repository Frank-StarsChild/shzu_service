import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatResponse, CitationRef } from "@/api/client";
import type { Places } from "@/stage/packs";
import { parseMeta } from "@/campus3d/meta";
import { issuerLabel, queryOf, traceFromResponse } from "@/stage/trace";

const PUB = resolve(__dirname, "../../public/campus3d");
const places = JSON.parse(readFileSync(resolve(PUB, "places.json"), "utf-8")) as Places;
const allMeta = parseMeta(JSON.parse(readFileSync(resolve(PUB, "all/campus.meta.json"), "utf-8")));
const bqMeta = parseMeta(JSON.parse(readFileSync(resolve(PUB, "bq/campus.meta.json"), "utf-8")));

function cit(issuer: string, id: string): CitationRef {
  return { id, title: "t", issuer, url: "https://example.invalid" };
}

function response(
  status: ChatResponse["status"],
  issuers: string[],
): ChatResponse {
  return {
    status,
    session_id: "s",
    request_id: "r",
    trace_id: "t",
    knowledge_version: "kb",
    citations: issuers.map((issuer, i) => cit(issuer, `c${i + 1}`)),
    unknown_fields: [],
  };
}

describe("stage/trace · A5 回放", () => {
  it("1 issuerLabel：全角括号优先，否则去掉石河子大学/党委", () => {
    expect(issuerLabel("石河子大学党委学生工作部（学生处）")).toBe("学生处");
    expect(issuerLabel("石河子大学图书馆")).toBe("图书馆");
    expect(issuerLabel("教务处")).toBe("教务处");
  });

  it("2 同一单位合并计数、保持首次顺序、不在表里的楼号记 null", () => {
    const r = response("answer", [
      "石河子大学学生处",
      "石河子大学学生处",
      "教务处",
      "某个对照表里没有的单位",
    ]);
    const { hits, evidence } = traceFromResponse(r, places, allMeta);
    expect(hits).toHaveLength(3);
    expect(hits[0].count).toBe(2);
    expect(hits[0].buildingId).toBe("ZQ-B023");
    expect(hits[1].buildingId).toBe("ZQ-B024");
    expect(hits[2].buildingId).toBeNull();
    expect(evidence).toBe(4);
  });

  it("3 换成北区沙盘：中区的楼都不在本沙盘上 → buildingId 全为 null", () => {
    const r = response("answer", [
      "石河子大学学生处",
      "石河子大学学生处",
      "教务处",
      "某个对照表里没有的单位",
    ]);
    const { hits } = traceFromResponse(r, places, bqMeta);
    expect(hits).toHaveLength(3);
    for (const h of hits) expect(h.buildingId).toBeNull();
  });

  it("4 最多 5 条；clarify 没有命中", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `单位${i + 1}`);
    expect(traceFromResponse(response("answer", seven), places, allMeta).hits).toHaveLength(5);
    expect(traceFromResponse(response("clarify", ["石河子大学学生处"]), places, allMeta)).toEqual({
      hits: [],
      evidence: 0,
    });
  });

  it("5 queryOf：去首尾空白，取前 10 个字", () => {
    expect(queryOf("  学生证丢了，去哪补办？  ")).toBe("学生证丢了，去哪补办");
    expect(queryOf("短问题")).toBe("短问题");
  });
});
