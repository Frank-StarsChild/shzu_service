// W5 验证：resolvePlace 的四条规则（用真实 places.json）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatResponse, CitationRef } from "@/api/client";
import { resolvePlace } from "@/stage/places";
import type { Places } from "@/stage/packs";

const places: Places = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/campus3d/places.json"), "utf-8")
);

/** 拼一个 status:'answer' 的回答：每段文字一个 block，每个发布单位一条出处 */
function r(texts: string[], issuers: string[]): ChatResponse {
  return {
    status: "answer",
    session_id: "s",
    request_id: "r",
    trace_id: "t",
    knowledge_version: "kb",
    answer: {
      blocks: texts.map((text) => ({ kind: "fact", text, citation_ids: [] })),
      unknown_fields: [],
    },
    unknown_fields: [],
    citations: issuers.map((issuer, i): CitationRef => ({
      id: `c${i + 1}`,
      title: `出处${i + 1}`,
      issuer,
      url: "https://example.com",
    })),
  };
}

describe("resolvePlace（真实 places.json）", () => {
  it("文字里的楼名：大学生活动中心南楼 → ZQ-B023", () => {
    expect(resolvePlace(r(["到大学生活动中心南楼301-302室办理"], ["石河子大学学生处"]), places)).toBe("ZQ-B023");
  });

  it("多个楼名：取出现位置最靠前的（行政楼在前）", () => {
    expect(resolvePlace(r(["在行政楼一楼大厅或博学楼B区自助打印机打印"], ["教务处"]), places)).toBe("ZQ-B024");
  });

  it("审批单送到博学楼C238中控室 → ZQ-B007", () => {
    expect(resolvePlace(r(["审批单送到博学楼C238中控室"], ["教务处"]), places)).toBe("ZQ-B007");
  });

  it("文字没楼名，靠发布单位：石河子大学图书馆 → ZQ-B034", () => {
    expect(resolvePlace(r(["本科生一次可以借 20 册"], ["石河子大学图书馆"]), places)).toBe("ZQ-B034");
  });

  it("第二段里的楼名优先于发布单位 → ZQ-B007", () => {
    expect(resolvePlace(r(["先在教务系统提交申请", "打印后送博学楼"], ["教务处"]), places)).toBe("ZQ-B007");
  });

  it("发布单位：文学艺术学院（新闻传播学院）→ JJ-B019", () => {
    expect(resolvePlace(r(["学院概况如下"], ["文学艺术学院（新闻传播学院）"]), places)).toBe("JJ-B019");
  });

  it("都没有：发布单位也不在表里 → null", () => {
    expect(resolvePlace(r(["没有提到任何地方"], ["教育部 财政部"]), places)).toBeNull();
  });

  it("「北区图书馆和图书馆都可以还书」→ 北区图书馆那个楼号（同位置取更长）", () => {
    expect(resolvePlace(r(["北区图书馆和图书馆都可以还书"], []), places)).toBe("BQ-B018");
  });

  it("学院已迁将军山：文学艺术学院 → JJ-B019", () => {
    expect(resolvePlace(r(["文学艺术学院现有教职工 173 人"], []), places)).toBe("JJ-B019");
  });

  it("护理学院（筹）对到 null：这一段作废，靠发布单位 → ZQ-B024（不许错指理学院）", () => {
    expect(resolvePlace(r(["护理学院（筹）的介绍"], ["教务处"]), places)).toBe("ZQ-B024");
  });

  it("clarify 的回答 → null", () => {
    const clarify: ChatResponse = {
      status: "clarify",
      session_id: "s",
      request_id: "r",
      trace_id: "t",
      knowledge_version: "kb",
      clarify: { question: "哪一种？", choices: [] },
      unknown_fields: [],
      citations: [],
    };
    expect(resolvePlace(clarify, places)).toBeNull();
  });
});
