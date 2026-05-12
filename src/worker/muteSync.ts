export interface AuthTokens { bearer: string; csrf: string; }

export interface TransportResponse { ok: boolean; status: number; bodyText: string; }
export type Transport = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<TransportResponse>;

export class RateLimitError extends Error {
  constructor(public readonly bodyText: string) {
    super(`Twitter 429 rate limited: ${bodyText}`);
    this.name = "RateLimitError";
  }
}

const defaultTransport: Transport = async (url, init) => {
  const r = await fetch(url, { ...init, credentials: "include" });
  return { ok: r.ok, status: r.status, bodyText: await r.text().catch(() => "") };
};

export class MuteSync {
  constructor(private auth: AuthTokens, private transport: Transport = defaultTransport) {}
  setAuth(a: AuthTokens): void { this.auth = a; }
  setTransport(t: Transport): void { this.transport = t; }

  // X requires the OAuth2Session marker; without it many internal endpoints 404
  // even with valid bearer + csrf. Captured from a real x.com manual-mute curl.
  private headers(): Record<string, string> {
    return {
      accept: "*/*",
      authorization: this.auth.bearer.startsWith("Bearer ") ? this.auth.bearer : `Bearer ${this.auth.bearer}`,
      "x-csrf-token": this.auth.csrf,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "zh-cn",
    };
  }

  private async postForm(url: string, params: Record<string, string>): Promise<void> {
    const body = new URLSearchParams(params).toString();
    const resp = await this.transport(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      if (resp.status === 429) {
        throw new RateLimitError(resp.bodyText.slice(0, 200));
      }
      throw new Error(`Twitter ${resp.status}: ${resp.bodyText.slice(0, 200)}`);
    }
  }

  muteKeyword(phrase: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/mutes/keywords/create.json", {
      keyword: phrase,
      mute_surfaces: "notifications,home_timeline,tweet_replies",
      // X rejects empty mute_options. "exclude_following_accounts" is the safest
      // default — it won't accidentally hide tweets from accounts you follow.
      mute_options: "exclude_following_accounts",
      duration: "",
    });
  }

  destroyKeyword(phrase: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/mutes/keywords/destroy.json", { keyword: phrase });
  }

  muteUser(restId: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/mutes/users/create.json", { user_id: restId });
  }

  unmuteUser(restId: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/mutes/users/destroy.json", { user_id: restId });
  }

  blockUser(restId: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/blocks/create.json", { user_id: restId });
  }

  unblockUser(restId: string): Promise<void> {
    return this.postForm("https://x.com/i/api/1.1/blocks/destroy.json", { user_id: restId });
  }
}
