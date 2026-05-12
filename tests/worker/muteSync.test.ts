import { describe, it, expect, vi, beforeEach } from "vitest";
import { MuteSync } from "@/worker/muteSync";

describe("MuteSync", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("muteKeyword posts to v1.1 endpoint with required Twitter session headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const m = new MuteSync({ bearer: "Bearer AAA", csrf: "csrftok" });
    await m.muteKeyword("加我vx");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/i/api/1.1/mutes/keywords/create.json",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          authorization: "Bearer AAA",
          "x-csrf-token": "csrftok",
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
        }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).body).toContain("keyword=%E5%8A%A0%E6%88%91vx");
    expect((init as RequestInit).body).toContain("mute_options=exclude_following_accounts");
  });

  it("muteUser posts user_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const m = new MuteSync({ bearer: "Bearer AAA", csrf: "csrftok" });
    await m.muteUser("9999");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.com/i/api/1.1/mutes/users/create.json");
    expect((init as RequestInit).body).toContain("user_id=9999");
  });

  it("throws on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" }));
    await expect(new MuteSync({ bearer: "x", csrf: "y" }).muteKeyword("k")).rejects.toThrow(/401/);
  });

  it("destroyKeyword posts to keywords/destroy.json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await new MuteSync({ bearer: "x", csrf: "y" }).destroyKeyword("kw");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/i/api/1.1/mutes/keywords/destroy.json",
      expect.anything(),
    );
  });

  it("blockUser posts to blocks/create.json with user_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await new MuteSync({ bearer: "Bearer AAA", csrf: "csrftok" }).blockUser("1585834324573753344");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.com/i/api/1.1/blocks/create.json");
    expect((init as RequestInit).body).toContain("user_id=1585834324573753344");
  });

  it("unblockUser posts to blocks/destroy.json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await new MuteSync({ bearer: "x", csrf: "y" }).unblockUser("123");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.com/i/api/1.1/blocks/destroy.json");
  });
});
