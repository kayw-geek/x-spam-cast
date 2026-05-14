import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearnedList } from "@/popup/components/LearnedList";
import type { ExtensionState } from "@/core/types";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

function stateWith(partial: Partial<ExtensionState["learned"]>): ExtensionState {
  const s = defaultState();
  s.learned = { ...s.learned, ...partial };
  return s;
}

// jsdom does not auto-toggle <details> on summary click; force-open the section.
function openSection(label: RegExp): void {
  const summary = screen.getByText(label);
  const details = summary.closest("details") as HTMLDetailsElement | null;
  if (!details) throw new Error(`no <details> ancestor for ${label}`);
  details.open = true;
}

// jsdom in this setup doesn't expose a working localStorage (the chrome stub in
// tests/setup.ts replaces globalThis); stub it locally so the mosaic-toggle path works.
const memStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memStorage.get(k) ?? null,
  setItem: (k: string, v: string) => { memStorage.set(k, v); },
  removeItem: (k: string) => { memStorage.delete(k); },
  clear: () => memStorage.clear(),
  key: () => null,
  length: 0,
});

beforeEach(() => {
  __resetStorage();
  memStorage.clear();
});

describe("LearnedList — reason accordion", () => {
  it("does not show the reason block by default", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    expect(screen.queryByText("crypto lure")).not.toBeInTheDocument();
  });

  it("expands the reason block when the toggle is clicked", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    expect(screen.getByText(/crypto lure/)).toBeInTheDocument();
  });

  it("shows the LLM source icon for llm-batch entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    expect(screen.getByText(/🤖/)).toBeInTheDocument();
  });

  it("shows the manual-add icon for manual-source entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "spam", addedAt: 1, hits: 0, reason: "manually added by you", source: "manual" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was spam blocked/i));
    expect(screen.getByText(/✋/)).toBeInTheDocument();
  });

  it("shows the pack-import icon for pack-source entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "scam", addedAt: 1, hits: 0, reason: "from pack", source: "pack" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was scam blocked/i));
    expect(screen.getByText(/📦/)).toBeInTheDocument();
  });

  it("shows fallback message when no reason recorded", () => {
    const state = stateWith({
      keywords: [{ phrase: "old entry", addedAt: 1, hits: 0 }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was old entry blocked/i));
    expect(screen.getByText(/no reason recorded/i)).toBeInTheDocument();
  });

  it("renders evidence link to x.com search for keywords", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "x", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    const link = screen.getByRole("link", { name: /evidence/i });
    expect(link).toHaveAttribute("href", "https://x.com/search?q=airdrop%20scam");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders evidence link to user profile for users", () => {
    const state = stateWith({
      keywords: [],
      users: [{ handle: "spammer", reason: "x", addedAt: 1, source: "llm-batch" }],
    });
    render(<LearnedList state={state} />);
    openSection(/Users/);
    fireEvent.click(screen.getByLabelText(/why was spammer blocked/i));
    const link = screen.getByRole("link", { name: /evidence/i });
    expect(link).toHaveAttribute("href", "https://x.com/spammer");
  });
});
