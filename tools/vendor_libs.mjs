// Vendor highlight.js, KaTeX and Mermaid into src/vendor (no bundler / no npm deps).
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "src", "vendor");

const UA = { "User-Agent": "Mozilla/5.0 (compatible; vendor-script)" };

async function get(url, as = "text") {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return as === "bytes" ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

async function write(rel, data) {
  const full = path.join(VENDOR, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  console.log("  wrote", rel);
}

async function run() {
  await mkdir(VENDOR, { recursive: true });

  // ---------- highlight.js ----------
  console.log("[highlight.js]");
  const hljs = await get("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js", "bytes");
  await write("highlight.min.js", hljs);

  const light = await get("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css");
  const dark = await get("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css");
  // Scope each theme so light only applies outside dark mode, and vice-versa.
  const scoped = `body:not([data-theme="dark"]){\n${light}\n}\nbody[data-theme="dark"]{\n${dark}\n}`;
  await write("hljs-themes.css", scoped);

  // ---------- KaTeX ----------
  console.log("[katex]");
  const KA = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";
  await write("katex/katex.min.js", await get(`${KA}/katex.min.js`, "bytes"));
  let kcss = await get(`${KA}/katex.min.css`);
  // Keep only woff2 sources to avoid 404s from missing woff/ttf files.
  kcss = kcss
    .replace(/,\s*url\([^)]*\.woff\)\s*format\([^)]*\)/g, "")
    .replace(/,\s*url\([^)]*\.ttf\)\s*format\([^)]*\)/g, "");
  await write("katex/katex.min.css", kcss);
  const fonts = [
    "KaTeX_AMS-Regular", "KaTeX_Caligraphic-Bold", "KaTeX_Caligraphic-Regular",
    "KaTeX_Fraktur-Bold", "KaTeX_Fraktur-Regular", "KaTeX_Main-Bold",
    "KaTeX_Main-BoldItalic", "KaTeX_Main-Italic", "KaTeX_Main-Regular",
    "KaTeX_Math-BoldItalic", "KaTeX_Math-Italic", "KaTeX_SansSerif-Bold",
    "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Regular", "KaTeX_Script-Regular",
    "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular",
    "KaTeX_Size4-Regular", "KaTeX_Typewriter-Regular",
  ];
  for (const f of fonts) {
    const buf = await get(`${KA}/fonts/${f}.woff2`, "bytes");
    await write(`katex/fonts/${f}.woff2`, buf);
  }

  // ---------- Mermaid (v9 UMD — single self-contained file, attaches window.mermaid) ----------
  console.log("[mermaid]");
  const mjs = await get("https://cdn.jsdelivr.net/npm/mermaid@9.4.3/dist/mermaid.min.js", "bytes");
  await write("mermaid/mermaid.min.js", mjs);

  console.log("DONE");
}

run().catch((e) => {
  console.error("VENDOR FAILED:", e);
  process.exit(1);
});
