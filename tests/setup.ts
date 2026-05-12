import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const storageMem = new Map<string, unknown>();

const storageArea = {
  get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(storageMem);
    }
    if (typeof keys === "string") {
      return storageMem.has(keys) ? { [keys]: storageMem.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (storageMem.has(k)) out[k] = storageMem.get(k);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(keys)) out[k] = storageMem.has(k) ? storageMem.get(k) : def;
    return out;
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) storageMem.set(k, v);
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) storageMem.delete(k);
  }),
  clear: vi.fn(async () => storageMem.clear()),
  getBytesInUse: vi.fn(async () => 0),
};

(globalThis as any).chrome = {
  storage: {
    local: storageArea,
    sync: storageArea,
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    id: "test-extension-id",
    lastError: undefined,
  },
  webRequest: {
    onBeforeSendHeaders: { addListener: vi.fn() },
    onCompleted: { addListener: vi.fn() },
  },
};

export const __resetStorage = () => storageMem.clear();
