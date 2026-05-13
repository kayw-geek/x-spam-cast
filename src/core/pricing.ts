// Best-effort default LLM prices in USD per 1 million tokens.
// Used as auto-fill suggestions when the user hasn't set their own pricing —
// they can always override (relays, promotions, and provider price changes
// mean these are only ballpark). Order matters: first match wins, so put
// more specific patterns before broader ones.

export interface ModelPrice {
  pricePerMillionInput: number;
  pricePerMillionOutput: number;
}

const PRICE_TABLE: { match: RegExp; price: ModelPrice }[] = [
  // OpenAI
  { match: /^gpt-4o-mini/i,       price: { pricePerMillionInput: 0.15, pricePerMillionOutput: 0.60 } },
  { match: /^gpt-4o/i,            price: { pricePerMillionInput: 2.50, pricePerMillionOutput: 10.00 } },
  { match: /^gpt-4\.1-mini/i,     price: { pricePerMillionInput: 0.40, pricePerMillionOutput: 1.60 } },
  { match: /^gpt-4\.1/i,          price: { pricePerMillionInput: 2.00, pricePerMillionOutput: 8.00 } },
  { match: /^o3-mini/i,           price: { pricePerMillionInput: 1.10, pricePerMillionOutput: 4.40 } },
  { match: /^o4-mini/i,           price: { pricePerMillionInput: 1.10, pricePerMillionOutput: 4.40 } },
  // Anthropic Claude
  { match: /haiku.*4|claude-haiku-4/i, price: { pricePerMillionInput: 1.00, pricePerMillionOutput: 5.00 } },
  { match: /haiku/i,              price: { pricePerMillionInput: 0.80, pricePerMillionOutput: 4.00 } },
  { match: /sonnet/i,             price: { pricePerMillionInput: 3.00, pricePerMillionOutput: 15.00 } },
  { match: /opus/i,               price: { pricePerMillionInput: 15.00, pricePerMillionOutput: 75.00 } },
  // DeepSeek
  { match: /deepseek-(chat|v3|v[45])/i, price: { pricePerMillionInput: 0.27, pricePerMillionOutput: 1.10 } },
  { match: /deepseek-reasoner/i,  price: { pricePerMillionInput: 0.55, pricePerMillionOutput: 2.19 } },
  { match: /deepseek/i,           price: { pricePerMillionInput: 0.27, pricePerMillionOutput: 1.10 } },
  // Generic budget assumption for unknown small models
];

export function suggestPriceForModel(model: string): ModelPrice | null {
  for (const row of PRICE_TABLE) {
    if (row.match.test(model)) return row.price;
  }
  return null;
}

export function estimateCostUSD(
  promptTokens: number,
  completionTokens: number,
  pricePerMillionInput?: number,
  pricePerMillionOutput?: number,
): number | null {
  if (pricePerMillionInput === undefined || pricePerMillionOutput === undefined) return null;
  return (promptTokens / 1_000_000) * pricePerMillionInput
       + (completionTokens / 1_000_000) * pricePerMillionOutput;
}

export function fmtUSD(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd >= 0.0001) return `$${usd.toFixed(4)}`;
  return usd === 0 ? "$0" : `<$0.0001`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
