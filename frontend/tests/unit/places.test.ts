// 按需定位：什么时候保持视角、什么时候给手动入口、什么时候自动飞。
// 用真实 places.json，不依赖网络与 3D 场景。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActionCard, ChatResponse, CitationRef } from "@/api/client";
import { asksLocation, decidePlace, isSmallTalk, matchNamedBuildings } from "@/stage/places";
import type { Places } from "@/stage/packs";

const places: Places = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/campus3d/places.json"), "utf-8")
);

function resp(
  texts: string[],
  issuers: string[] = [],
  actions: ActionCard[] = [],
  status: ChatResponse["status"] = "answer",
): ChatResponse {
  return {
    status,
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
      id: `c${i + 1}`, title: `出处${i + 1}`, issuer, url: "https://example.com",
    })),
    actions,
  };
}

function placeCard(matches: (string | null)[], opts: { ambiguous?: boolean; text?: string | null } = {}): ActionCard {
  return {
    kind: "place",
    ambiguous: opts.ambiguous ?? false,
    matches: matches.map((bid, i) => ({
      building_id: bid,
      label: (bid && places.names.find(([, id]) => id === bid)?.[0]) || `楼${i + 1}`,
      category: "办公",
      campus: "中区",
      note: "",
    })),
    fallback_text: opts.text ?? null,
  } as ActionCard;
}

const ZQ = new Set(["ZQ-B023", "ZQ-B024", "ZQ-B034", "ZQ-B007", "ZQ-B031"]);

describe("asksLocation：按整句判断问的是不是位置", () => {
  it.each([
    ["学生证丢了去哪补办", true],
    ["成绩单去哪打印", true],
    ["图书馆在哪", true],
    ["你好，图书馆在哪", true],
    ["在沙盘定位图书馆", true],
    ["音乐系在哪栋楼", true],
    ["怎么走", true],
    ["你好", false],
    ["谢谢", false],
    ["图书馆几点关门", false],
    ["图书馆能借几本书", false],
    ["本科生最多能借几本书", false],
    ["图书馆的借阅规则在哪看", false],
    ["怎么借书", false],
    ["成绩单怎么打印", false],
    ["奖学金要什么条件", false],
    ["学生证办理时间", false],
  ])("%s → %s", (q, want) => {
    expect(asksLocation(q)).toBe(want);
  });
});

describe("isSmallTalk", () => {
  it("纯问候/致谢", () => {
    expect(isSmallTalk("你好")).toBe(true);
    expect(isSmallTalk("谢谢！")).toBe(true);
    expect(isSmallTalk("你好，图书馆在哪")).toBe(false);
    expect(isSmallTalk("本科生最多能借几本书")).toBe(false);
  });
});

describe("matchNamedBuildings：优先完整名称", () => {
  it("「北区图书馆在哪」只算北区图书馆，不再把「图书馆」算成第二栋", () => {
    const ids = matchNamedBuildings("北区图书馆在哪", places);
    expect(ids).toEqual(["BQ-B018"]);
  });

  it("「北区图书馆和图书馆都可以还书」两个地点都在句子里：各算一个", () => {
    const ids = matchNamedBuildings("北区图书馆和图书馆都可以还书", places);
    expect(ids.sort()).toEqual(["BQ-B018", "ZQ-B034"].sort());
  });
});

describe("decidePlace：保持视角（hold）", () => {
  it("问候即使误带 place 卡、正文楼名、图书馆 issuer 也不动镜头", () => {
    const r = resp(["你好！我是石大智多星，可以问校园办事。"], ["石河子大学图书馆"], [placeCard(["ZQ-B034"])]);
    const d = decidePlace({ question: "你好", response: r, places, inScene: ZQ });
    expect(d.action).toBe("hold");
    expect(d.candidates).toEqual([]);
  });

  it("借几本书（引用图书馆）只看答复", () => {
    const r = resp(["本科生一次最多借 20 本。"], ["石河子大学图书馆"]);
    expect(decidePlace({ question: "本科生最多能借几本书", response: r, places, inScene: ZQ }).action).toBe("hold");
  });

  it("图书馆几点关门：有时间没地点", () => {
    const r = resp(["图书馆每天 22:30 闭馆。"], ["石河子大学图书馆"]);
    expect(decidePlace({ question: "图书馆几点关门", response: r, places, inScene: ZQ }).action).toBe("hold");
  });

  it("怎么借书 / 成绩单怎么打印：原操作说明照常，不定位", () => {
    const r1 = resp(["到自助终端借还。"], ["石河子大学图书馆"], [placeCard(["ZQ-B034"])]);
    expect(decidePlace({ question: "怎么借书", response: r1, places, inScene: ZQ }).action).toBe("hold");
    const r2 = resp(["在行政楼一楼自助打印。"], ["教务处"], [placeCard(["ZQ-B024"])]);
    expect(decidePlace({ question: "成绩单怎么打印", response: r2, places, inScene: ZQ }).action).toBe("hold");
  });

  it("澄清 / 超范围 / 错误状态：各自界面处理", () => {
    const c = resp(["哪种卡？"], [], [], "clarify");
    expect(decidePlace({ question: "补办卡去哪", response: c, places, inScene: ZQ }).action).toBe("hold");
    const o = resp(["不在范围内"], [], [], "out_of_scope");
    expect(decidePlace({ question: "校长是谁", response: o, places, inScene: ZQ }).action).toBe("hold");
    const e = resp(["模型错误"], [], [], "error");
    expect(decidePlace({ question: "学生证去哪补", response: e, places, inScene: ZQ }).action).toBe("hold");
  });

  it("问位置但只有正文楼名、没有点名也没有结构化：保持", () => {
    const r = resp(["到行政楼办理。"], ["教务处"]);
    expect(decidePlace({ question: "这个去哪办", response: r, places, inScene: ZQ }).action).toBe("hold");
  });
});

describe("decidePlace：自动定位（auto）", () => {
  it("学生证丢了去哪补办：errand 与 place 指向同一栋楼只算一个目标", () => {
    const r = resp(
      ["到大学生活动中心南楼301-302室办理。"],
      ["石河子大学学生处"],
      [
        {
          kind: "errand",
          place: { building: "大学生活动中心（南楼）", building_id: "ZQ-B023", campus: "中区" },
        } as ActionCard,
        placeCard(["ZQ-B023"]),
      ],
    );
    const d = decidePlace({ question: "学生证丢了去哪补办", response: r, places, inScene: ZQ });
    expect(d.action).toBe("auto");
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].buildingId).toBe("ZQ-B023");
  });

  it("「你好，学生证丢了去哪补办」仍然定位", () => {
    const r = resp(["到大学生活动中心。"], [], [placeCard(["ZQ-B023"])]);
    expect(decidePlace({ question: "你好，学生证丢了去哪补办", response: r, places, inScene: ZQ }).action)
      .toBe("auto");
  });

  it("图书馆在哪：结构化唯一且在当前场景 → 自动", () => {
    const r = resp(["图书馆在中区。"], ["石河子大学图书馆"], [placeCard(["ZQ-B034"])]);
    const d = decidePlace({ question: "图书馆在哪", response: r, places, inScene: ZQ });
    expect(d.action).toBe("auto");
    expect(d.candidates[0].buildingId).toBe("ZQ-B034");
  });

  it("正文里先出现别的楼名也不影响：只认结构化结果", () => {
    const r = resp(["行政楼旁就是图书馆。"], ["石河子大学图书馆"], [placeCard(["ZQ-B034"])]);
    expect(decidePlace({ question: "图书馆在哪", response: r, places, inScene: ZQ }).candidates[0].buildingId)
      .toBe("ZQ-B034");
  });
});

describe("decidePlace：手动入口（offer）", () => {
  it("两个不同楼号：都给出来，不默认第一条", () => {
    const r = resp(["两个馆都能还书。"], [], [placeCard(["BQ-B018", "ZQ-B034"])]);
    const d = decidePlace({ question: "哪里能还书", response: r, places, inScene: ZQ });
    expect(d.action).toBe("offer");
    expect(d.candidates.map((c) => c.buildingId)).toEqual(["BQ-B018", "ZQ-B034"]);
  });

  it("工具标了 ambiguous → 手动", () => {
    const r = resp(["可能指两个地方。"], [], [placeCard(["ZQ-B034"], { ambiguous: true })]);
    expect(decidePlace({ question: "图书馆在哪", response: r, places, inScene: ZQ }).action).toBe("offer");
  });

  it("目标在当前场景之外（跨校区）→ 手动，候选带目标沙盘", () => {
    const r = resp(["音乐系在将军山。"], [], [placeCard(["JJ-B019"])]);
    const d = decidePlace({
      question: "音乐系在哪", response: r, places, inScene: ZQ,
      packNameOf: (id) => (id === "jjs" ? "将军山校区" : null),
    });
    expect(d.action).toBe("offer");
    expect(d.candidates[0].inScene).toBe(false);
    expect(d.candidates[0].context).toBe("将军山校区");
  });

  it("场景未就绪：仍是手动入口，候选可读", () => {
    const r = resp(["图书馆在中区。"], [], [placeCard(["ZQ-B034"])]);
    const d = decidePlace({ question: "图书馆在哪", response: r, places, inScene: null });
    expect(d.action).toBe("offer");
    expect(d.reason).toBe("scene-not-ready");
    expect(d.candidates[0].name).toContain("图书馆");
  });

  it("只有用户点名的登记楼栋、没有结构化结果 → 手动", () => {
    const r = resp(["图书馆在中区。"], ["石河子大学图书馆"]);
    const d = decidePlace({ question: "图书馆在哪", response: r, places, inScene: ZQ });
    expect(d.action).toBe("offer");
    expect(d.reason).toBe("named-only");
    expect(d.candidates[0].buildingId).toBe("ZQ-B034");
  });

  it("只有文字地址：保留文字，不猜楼", () => {
    const r = resp(["到老行政楼后面的平房。"], [], [placeCard([], { text: "老行政楼后面的平房（未登记楼号）" })]);
    const d = decidePlace({ question: "这个在哪办", response: r, places, inScene: ZQ });
    expect(d.action).toBe("offer");
    expect(d.reason).toBe("text-only");
    expect(d.candidates).toEqual([]);
    expect(d.text).toContain("老行政楼");
  });
});
