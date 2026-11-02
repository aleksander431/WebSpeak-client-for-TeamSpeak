// Syntax highlighting for chat code blocks. highlight.js and its grammars load
// on first use, so pages without code never download them. The returned HTML
// comes from highlight.js, which escapes the source text itself.

type Highlighter = (code: string, language: string) => { html: string; language: string } | null;

let pending: Promise<Highlighter> | null = null;

const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash",
  console: "bash", ps: "powershell", ps1: "powershell", cs: "csharp", "c#": "csharp",
  "c++": "cpp", hpp: "cpp", h: "c", rs: "rust", golang: "go", kt: "kotlin", yml: "yaml",
  html: "xml", vue: "xml", svg: "xml", toml: "ini", conf: "ini", docker: "dockerfile",
  md: "markdown", patch: "diff", jsonc: "json", rb: "ruby", gd: "gdscript",
};

/** Up to this many characters are highlighted; longer code is shown plain. */
const MAX_HIGHLIGHT_LENGTH = 20_000;

function load(): Promise<Highlighter> {
  pending ??= (async () => {
    const [core, ...languages] = await Promise.all([
      import("highlight.js/lib/core"),
      import("highlight.js/lib/languages/javascript"), import("highlight.js/lib/languages/typescript"),
      import("highlight.js/lib/languages/python"), import("highlight.js/lib/languages/bash"),
      import("highlight.js/lib/languages/json"), import("highlight.js/lib/languages/xml"),
      import("highlight.js/lib/languages/css"), import("highlight.js/lib/languages/c"),
      import("highlight.js/lib/languages/cpp"), import("highlight.js/lib/languages/csharp"),
      import("highlight.js/lib/languages/java"), import("highlight.js/lib/languages/kotlin"),
      import("highlight.js/lib/languages/go"), import("highlight.js/lib/languages/rust"),
      import("highlight.js/lib/languages/sql"), import("highlight.js/lib/languages/yaml"),
      import("highlight.js/lib/languages/ini"), import("highlight.js/lib/languages/dockerfile"),
      import("highlight.js/lib/languages/powershell"), import("highlight.js/lib/languages/php"),
      import("highlight.js/lib/languages/lua"), import("highlight.js/lib/languages/diff"),
      import("highlight.js/lib/languages/markdown"), import("highlight.js/lib/languages/ruby"),
      import("highlight.js/lib/languages/nginx"),
    ]);
    const names = ["javascript", "typescript", "python", "bash", "json", "xml", "css", "c", "cpp", "csharp",
      "java", "kotlin", "go", "rust", "sql", "yaml", "ini", "dockerfile", "powershell", "php", "lua", "diff",
      "markdown", "ruby", "nginx"];
    const hljs = core.default.newInstance();
    languages.forEach((module, index) => hljs.registerLanguage(names[index], module.default));
    return (code: string, language: string) => {
      if (code.length > MAX_HIGHLIGHT_LENGTH) return null;
      const name = ALIASES[language] ?? language;
      try {
        if (name && hljs.getLanguage(name)) return { html: hljs.highlight(code, { language: name, ignoreIllegals: true }).value, language: name };
        if (name) return null; // an unknown language stays plain rather than guessed
        const result = hljs.highlightAuto(code);
        return result.language && result.relevance >= 5 ? { html: result.value, language: result.language } : null;
      } catch {
        return null;
      }
    };
  })().catch(error => { pending = null; throw error; });
  return pending;
}

export async function highlightCode(code: string, language: string): Promise<{ html: string; language: string } | null> {
  try {
    return (await load())(code, language);
  } catch {
    return null;
  }
}
