"use client";
import { useI18n } from "@/components/LocaleProvider";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/ui/Icon";
import {
  faRotateRight,
  faFloppyDisk,
  faEye,
  faCode,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirror = dynamic(
  () => import("@uiw/react-codemirror").then((m) => m.default),
  {
    ssr: false,
    loading: function EditorLoading() {
      const { t } = useI18n();
      return (
        <div className="flex h-64 items-center justify-center text-white/30 text-sm">
          {t("Loading editor…")}
        </div>
      );
    },
  },
);

/** Detect language from filename for display */
export function detectLangLabel(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "JavaScript",
    jsx: "JavaScript",
    ts: "TypeScript",
    tsx: "TypeScript",
    py: "Python",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    java: "Java",
    c: "C",
    cpp: "C++",
    cs: "C#",
    swift: "Swift",
    kt: "Kotlin",
    php: "PHP",
    html: "HTML",
    htm: "HTML",
    css: "CSS",
    scss: "SCSS",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    sql: "SQL",
    sh: "Shell",
    bash: "Bash",
    bat: "Batch",
    md: "Markdown",
    markdown: "Markdown",
    txt: "Text",
    xml: "XML",
    graphql: "GraphQL",
    vue: "Vue",
    svelte: "Svelte",
    lua: "Lua",
    r: "R",
    dart: "Dart",
  };
  return map[ext] ?? (ext.toUpperCase() || "Text");
}

/** Check if file is a text/editable file */
export function isEditableTextFile(
  filename: string,
  mimeType: string,
): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const editableExts = new Set([
    "txt",
    "md",
    "markdown",
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "cs",
    "swift",
    "kt",
    "php",
    "html",
    "htm",
    "css",
    "scss",
    "json",
    "yaml",
    "yml",
    "toml",
    "sql",
    "sh",
    "bash",
    "bat",
    "xml",
    "graphql",
    "vue",
    "svelte",
    "lua",
    "r",
    "dart",
    "env",
    "gitignore",
    "dockerfile",
    "makefile",
    "cfg",
    "conf",
    "ini",
    "log",
  ]);
  if (editableExts.has(ext)) return true;
  if (mimeType.startsWith("text/")) return true;
  if (
    [
      "application/json",
      "application/javascript",
      "application/typescript",
      "application/xml",
      "application/x-sh",
    ].includes(mimeType)
  )
    return true;
  return false;
}

/** Inner component that dynamically loads the right language extension */
function EditorWithLang({
  value,
  onChange,
  filename,
}: {
  value: string;
  onChange: (v: string) => void;
  filename: string;
}) {
  const { t, dateLocale } = useI18n();

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  // We use a key to re-mount when language changes
  const [extensions, setExtensions] = useState<any[]>([]);
  const [langLoaded, setLangLoaded] = useState(false);

  useEffect(() => {
    setLangLoaded(false);
    async function loadLang() {
      const exts: any[] = [];
      try {
        if (["js", "jsx", "ts", "tsx"].includes(ext)) {
          const { javascript } = await import("@codemirror/lang-javascript");
          exts.push(
            javascript({
              jsx: ext === "jsx" || ext === "tsx",
              typescript: ext === "ts" || ext === "tsx",
            }),
          );
        } else if (ext === "py") {
          const { python } = await import("@codemirror/lang-python");
          exts.push(python());
        } else if (["html", "htm", "vue", "svelte"].includes(ext)) {
          const { html } = await import("@codemirror/lang-html");
          exts.push(html());
        } else if (["css", "scss"].includes(ext)) {
          const { css } = await import("@codemirror/lang-css");
          exts.push(css());
        } else if (ext === "json") {
          const { json } = await import("@codemirror/lang-json");
          exts.push(json());
        } else if (["md", "markdown"].includes(ext)) {
          const { markdown } = await import("@codemirror/lang-markdown");
          exts.push(markdown());
        } else if (ext === "sql") {
          const { sql } = await import("@codemirror/lang-sql");
          exts.push(sql());
        }
      } catch {
        /* fallback to no language */
      }
      setExtensions(exts);
      setLangLoaded(true);
    }
    loadLang();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext]);

  if (!langLoaded) {
    return (
      <div className="flex h-64 items-center justify-center text-white/30 text-sm">
        {t("Detecting language…")}
      </div>
    );
  }

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="dark"
      className="overflow-hidden rounded-lg border border-white/10 text-sm"
      style={{ minHeight: "320px", maxHeight: "60vh", overflowY: "auto" }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: true,
      }}
    />
  );
}

interface CdnTextEditorProps {
  fileId: string;
  filename: string;
  mimeType: string;
  content: string;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function CdnTextEditor({
  filename,
  content,
  loading,
  saving,
  onChange,
  onSave,
  onClose,
}: CdnTextEditorProps) {
  const { t, dateLocale } = useI18n();

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = ext === "md" || ext === "markdown";
  const [showPreview, setShowPreview] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/50">
            {t(detectLangLabel(filename))}
          </span>
          <span className="text-xs text-white/30">{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown && (
            <button
              onClick={() => setShowPreview((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                showPreview
                  ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
                  : "border-white/10 bg-white/5 text-white/50 hover:text-white"
              }`}
            >
              <Icon icon={showPreview ? faCode : faEye} />
              {showPreview ? "Editor" : t("Preview")}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:text-white"
            title={t("Close")}
          >
            <Icon icon={faXmark} />
          </button>
        </div>
      </div>

      {/* Editor / Preview area */}
      {loading ? (
        <div className="flex h-64 items-center justify-center gap-3 text-white/30">
          <Icon icon={faRotateRight} className="animate-spin" />
          <span className="text-sm">{t("Loading file…")}</span>
        </div>
      ) : isMarkdown && showPreview ? (
        <div className="prose prose-invert prose-sm min-h-64 max-h-[60vh] max-w-none overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <EditorWithLang
          value={content}
          onChange={onChange}
          filename={filename}
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-white/30">
          <kbd className="rounded bg-white/5 px-1 py-0.5 text-[10px]">
            Ctrl+S
          </kbd>{" "}
          {t("to save")}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-white/50 transition-colors hover:text-white"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={onSave}
            disabled={saving || loading}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-orange-400 disabled:opacity-50"
          >
            {saving ? (
              <Icon icon={faRotateRight} className="animate-spin" />
            ) : (
              <Icon icon={faFloppyDisk} />
            )}
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
