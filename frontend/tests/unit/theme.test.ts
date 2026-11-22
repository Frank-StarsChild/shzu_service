import { describe, expect, it } from "vitest";
import { parseStoredTheme, resolveApplied, THEME_STORAGE_KEY } from "@/stores/theme";

// 主题令牌：模式解析与生效主题求值（全站 data-theme 的唯一决策逻辑）
describe("parseStoredTheme：存储值解析", () => {
  it("合法三值原样返回", () => {
    expect(parseStoredTheme("light")).toBe("light");
    expect(parseStoredTheme("dark")).toBe("dark");
    expect(parseStoredTheme("system")).toBe("system");
  });

  it("无效值（未知串 / 空 / null / undefined）一律回退 system", () => {
    expect(parseStoredTheme("blue")).toBe("system");
    expect(parseStoredTheme("LIGHT")).toBe("system");
    expect(parseStoredTheme("")).toBe("system");
    expect(parseStoredTheme(null)).toBe("system");
    expect(parseStoredTheme(undefined)).toBe("system");
  });

  it("存储键为 shzu.theme", () => {
    expect(THEME_STORAGE_KEY).toBe("shzu.theme");
  });
});

describe("resolveApplied：生效主题求值", () => {
  it("手动日间 / 夜间不受系统影响", () => {
    expect(resolveApplied("light", true)).toBe("light");
    expect(resolveApplied("light", false)).toBe("light");
    expect(resolveApplied("dark", true)).toBe("dark");
    expect(resolveApplied("dark", false)).toBe("dark");
  });

  it("跟随系统时随系统外观切换（也只有此时自动应用）", () => {
    expect(resolveApplied("system", true)).toBe("dark");
    expect(resolveApplied("system", false)).toBe("light");
  });
});
