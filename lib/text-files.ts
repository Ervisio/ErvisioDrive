// Shared by the editor UI and the content API, so both agree on what is editable.

export const ODT_MIME = "application/vnd.oasis.opendocument.text";
export const TEXT_EDITOR_LIMIT = 2 * 1024 * 1024;
export const ODT_EDITOR_LIMIT = 10 * 1024 * 1024;

const LANGUAGES: Record<string, string> = {
  txt: "Text",
  text: "Text",
  log: "Log",
  md: "Markdown",
  markdown: "Markdown",
  mdx: "MDX",
  rst: "reStructuredText",
  adoc: "AsciiDoc",
  tex: "LaTeX",
  csv: "CSV",
  tsv: "TSV",
  odt: "OpenDocument",
  html: "HTML",
  htm: "HTML",
  xhtml: "HTML",
  xml: "XML",
  svg: "SVG",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  tsx: "TypeScript",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  json: "JSON",
  jsonc: "JSON",
  json5: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  cfg: "Config",
  conf: "Config",
  properties: "Properties",
  env: "Env",
  py: "Python",
  pyw: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  groovy: "Groovy",
  gradle: "Gradle",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  cs: "C#",
  swift: "Swift",
  m: "Objective-C",
  dart: "Dart",
  php: "PHP",
  pl: "Perl",
  pm: "Perl",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  fs: "F#",
  ml: "OCaml",
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protobuf",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  fish: "Shell",
  ps1: "PowerShell",
  bat: "Batch",
  cmd: "Batch",
  tf: "Terraform",
  hcl: "HCL",
  nginx: "Nginx",
  diff: "Diff",
  patch: "Diff",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  gitignore: "Git",
  gitattributes: "Git",
  editorconfig: "Config",
};

// Files usually named without an extension.
const BARE_NAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  readme: "txt",
  license: "txt",
  procfile: "txt",
  ".gitignore": "gitignore",
  ".gitattributes": "gitattributes",
  ".editorconfig": "editorconfig",
  ".env": "env",
};

const TEXT_MIMES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/x-sh",
  "application/x-yaml",
  "application/toml",
  "application/sql",
  "image/svg+xml",
]);

/** Normalized format key for a file name: the extension or a known bare name. */
export function fileKind(filename: string): string {
  const base = filename.split("/").pop()!.toLowerCase();
  if (BARE_NAMES[base]) return BARE_NAMES[base];
  if (base.startsWith(".env.")) return "env";
  if (base.startsWith("dockerfile.")) return "dockerfile";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

export function languageLabel(filename: string): string {
  const kind = fileKind(filename);
  return LANGUAGES[kind] ?? (kind.toUpperCase() || "Text");
}

export const isOdtFile = (filename: string, mimeType = "") =>
  fileKind(filename) === "odt" || mimeType === ODT_MIME;

export function isEditableTextFile(filename: string, mimeType: string): boolean {
  if (isOdtFile(filename, mimeType)) return true;
  if (LANGUAGES[fileKind(filename)]) return true;
  return mimeType.startsWith("text/") || TEXT_MIMES.has(mimeType);
}
