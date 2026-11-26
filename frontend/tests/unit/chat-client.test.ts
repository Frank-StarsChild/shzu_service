import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("聊天超过普通接口的 20 秒时限后仍可收到答复", async () => {
  vi.useFakeTimers();
  const reply = { status: "answer", message: "已核查" };
  const fetch = vi.fn((_: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    setTimeout(() => resolve(Response.json(reply)), 25_000);
  }));
  vi.stubGlobal("fetch", fetch);

  const pending = api.chat({ session_id: "session", request_id: "request", message: "查询校园通知" });
  const answer = expect(pending).resolves.toEqual(reply);
  await vi.advanceTimersByTimeAsync(25_000);
  await answer;
  expect(fetch).toHaveBeenCalledTimes(1);
});
