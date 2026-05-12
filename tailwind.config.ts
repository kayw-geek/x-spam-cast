import type { Config } from "tailwindcss";
export default {
  content: ["./entrypoints/popup/**/*.{tsx,html}", "./src/popup/**/*.tsx"],
  theme: { extend: {} },
} satisfies Config;
