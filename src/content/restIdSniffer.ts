export const TSF_BRIDGE_TAG = "__TSF_BRIDGE__";

export type BridgeMessage =
  | { tag: typeof TSF_BRIDGE_TAG; kind: "restId"; handle: string; restId: string }
  | { tag: typeof TSF_BRIDGE_TAG; kind: "auth"; bearer: string; csrf: string };

export class RestIdSniffer {
  install(): void {
    const originalFetch = window.fetch.bind(window);
    const self = this;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isGraphql = url.includes("/i/api/graphql/");
      if (isGraphql) {
        const headers = new Headers(init?.headers);
        const auth = headers.get("authorization");
        const csrf = headers.get("x-csrf-token");
        if (auth && csrf) {
          window.postMessage({ tag: TSF_BRIDGE_TAG, kind: "auth", bearer: auth, csrf } satisfies BridgeMessage, "*");
        }
      }
      const resp = await originalFetch(input as RequestInfo, init);
      if (isGraphql && resp.ok) {
        try {
          const cloned = resp.clone();
          const json = await cloned.json();
          self.walkAndPost(json);
        } catch { /* non-JSON, ignore */ }
      }
      return resp;
    };
  }

  private walkAndPost(node: unknown): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) this.walkAndPost(item); return; }
    const obj = node as Record<string, unknown>;
    const restId = obj["rest_id"];
    const legacy = obj["legacy"] as Record<string, unknown> | undefined;
    const screenName = legacy?.["screen_name"];
    if (typeof restId === "string" && typeof screenName === "string") {
      window.postMessage({ tag: TSF_BRIDGE_TAG, kind: "restId", handle: screenName, restId } satisfies BridgeMessage, "*");
    }
    for (const v of Object.values(obj)) this.walkAndPost(v);
  }
}
