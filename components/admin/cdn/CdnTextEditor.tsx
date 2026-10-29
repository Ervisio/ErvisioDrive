"use client";
import { useI18n } from "@/components/LocaleProvider";

import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Extension } from "@codemirror/state";
import type { StreamParser } from "@codemirror/language";
import { Icon } from "@/components/ui/Icon";
import {
  faRotateRight,
  faFloppyDisk,
  faEye,
  faCode,
  faTableColumns,
  faLock,
} from "@fortawesome/free-solid-svg-icons";
import { fileKind, languageLabel } from "@/lib/text-files";

export { isEditableTextFile } from "@/lib/text-files";
export const detectLangLabel = languageLabel;

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirror = dynamic(
  () => import("@uiw/react-codemirror").then((m) => m.default),
  {
    ssr: false,
    loading: function EditorLoading() {
      const { t } = useI18n();
      return (
        <div className="flex h-64 items-center justify-center text-ink-faint text-sm">
          {t("Loading editor…")}
        </div>
      );
    },
  },
);

const MARKDOWN_KINDS = new Set(["md", "markdown", "mdx", "odt"]);
const HTML_KINDS = new Set(["html", "htm", "xhtml", "svg"]);

/** Per-device preference: open the editor as a dialog or as a side panel. */
export type EditorLayout = "dialog" | "panel";
const LAYOUT_KEY = "editor-layout";
export function useEditorLayout(): [EditorLayout, (value: EditorLayout) => void] {
  const [layout, setLayout] = useState<EditorLayout>("dialog");
  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === "panel") setLayout("panel");
    } catch {}
  }, []);
  return [
    layout,
    (value) => {
      setLayout(value);
      try {
        localStorage.setItem(LAYOUT_KEY, value);
      } catch {}
    },
  ];
}

export type PreviewKind = "markdown" | "html" | null;
export function previewKind(filename: string): PreviewKind {
  const kind = fileKind(filename);
  if (MARKDOWN_KINDS.has(kind)) return "markdown";
  if (HTML_KINDS.has(kind)) return "html";
  return null;
}

/** Follows the app theme: data-theme wins, otherwise the system preference. */
function useDarkTheme() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)"),
        observer = new MutationObserver(notify);
      media.addEventListener("change", notify);
      observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
      return () => {
        media.removeEventListener("change", notify);
        observer.disconnect();
      };
    },
    () => {
      const forced = document.documentElement.dataset.theme;
      return forced
        ? forced === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    },
    () => false,
  );
}

async function legacy(load: () => Promise<StreamParser<unknown>>) {
  const [{ StreamLanguage }, mode] = await Promise.all([
    import("@codemirror/language"),
    load(),
  ]);
  return StreamLanguage.define(mode);
}

async function languageFor(kind: string): Promise<Extension | null> {
  switch (kind) {
    case "js": case "mjs": case "cjs": case "jsx":
    case "ts": case "mts": case "cts": case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({
        jsx: kind === "jsx" || kind === "tsx",
        typescript: ["ts", "mts", "cts", "tsx"].includes(kind),
      });
    }
    case "json": case "jsonc": case "json5":
      return (await import("@codemirror/lang-json")).json();
    case "py": case "pyw":
      return (await import("@codemirror/lang-python")).python();
    case "html": case "htm": case "xhtml": case "vue": case "svelte": case "astro": case "php":
      return (await import("@codemirror/lang-html")).html();
    case "css": case "scss": case "less":
      return (await import("@codemirror/lang-css")).css();
    case "md": case "markdown": case "mdx": case "odt":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "xml": case "svg":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/xml")).xml);
    case "sh": case "bash": case "zsh": case "fish": case "env":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell);
    case "yaml": case "yml":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml);
    case "toml":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml);
    case "ini": case "cfg": case "conf": case "properties": case "editorconfig": case "gitignore": case "gitattributes":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties);
    case "go":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go);
    case "rs":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/rust")).rust);
    case "rb":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby);
    case "lua":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/lua")).lua);
    case "swift":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift);
    case "r":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/r")).r);
    case "ps1":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell);
    case "dockerfile":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile);
    case "diff": case "patch":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/diff")).diff);
    case "pl": case "pm":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/perl")).perl);
    case "nginx":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/nginx")).nginx);
    case "jl":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/julia")).julia);
    case "erl":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/erlang")).erlang);
    case "hs":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/haskell")).haskell);
    case "clj":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/clojure")).clojure);
    case "ml":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/mllike")).oCaml);
    case "fs":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/mllike")).fSharp);
    case "proto":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf);
    case "groovy": case "gradle":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/groovy")).groovy);
    case "sass":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/sass")).sass);
    case "tex":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/stex")).stex);
    case "c": case "h": case "cpp": case "cc": case "cxx": case "hpp": case "hh":
    case "java": case "cs": case "kt": case "kts": case "scala": case "dart": case "m": {
      const clike = await import("@codemirror/legacy-modes/mode/clike");
      const modes: Record<string, typeof clike.c> = {
        c: clike.c, h: clike.c, cpp: clike.cpp, cc: clike.cpp, cxx: clike.cpp,
        hpp: clike.cpp, hh: clike.cpp, java: clike.java, cs: clike.csharp,
        kt: clike.kotlin, kts: clike.kotlin, scala: clike.scala, dart: clike.dart,
        m: clike.objectiveC,
      };
      return legacy(async () => modes[kind]);
    }
    default:
      return null;
  }
}

/** Inner component that dynamically loads the right language extension */
function EditorWithLang({
  value,
  onChange,
  filename,
  readOnly = false,
  fill = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  filename: string;
  readOnly?: boolean;
  fill?: boolean;
}) {
  const { t } = useI18n();
  const dark = useDarkTheme();
  const kind = fileKind(filename);
  const [extensions, setExtensions] = useState<Extension[] | null>(null);

  useEffect(() => {
    let alive = true;
    setExtensions(null);
    languageFor(kind)
      .catch(() => null)
      .then(async (lang) => {
        const { EditorView } = await import("@codemirror/view");
        if (alive)
          setExtensions(lang ? [lang, EditorView.lineWrapping] : [EditorView.lineWrapping]);
      });
    return () => {
      alive = false;
    };
  }, [kind]);

  if (!extensions) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-faint text-sm">
        {t("Detecting language…")}
      </div>
    );
  }

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      theme={dark ? "dark" : "light"}
      className="text-editor overflow-hidden rounded-card border border-white/10 text-sm"
      height={fill ? "100%" : undefined}
      style={fill ? { height: "100%" } : { minHeight: "320px", maxHeight: "min(62vh, calc(100dvh - 380px))", overflowY: "auto" }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        autocompletion: !readOnly,
      }}
    />
  );
}

/** Rendered Markdown or sandboxed HTML. Scripts never run in the HTML preview. */
export function RenderedPreview({
  kind,
  content,
  className = "",
}: {
  kind: Exclude<PreviewKind, null>;
  content: string;
  className?: string;
}) {
  const { t } = useI18n();
  if (kind === "html")
    return (
      <iframe
        sandbox=""
        srcDoc={content}
        title={t("Preview")}
        // Pages assume the browser's default white canvas, in either theme.
        style={{ background: "Canvas", colorScheme: "light" }}
        className={`w-full rounded-card border border-white/10 ${className}`}
      />
    );
  return (
    <div
      className={`prose prose-drive prose-sm max-w-none overflow-y-auto rounded-card border border-white/10 bg-sheet px-6 py-5 ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/** Read-only view used by the preview modal. */
export function TextPreview({
  filename,
  content,
}: {
  filename: string;
  content: string;
}) {
  const kind = previewKind(filename);
  return kind ? (
    <RenderedPreview kind={kind} content={content} className="h-[70vh]" />
  ) : (
    <div className="w-full">
      <EditorWithLang value={content} filename={filename} readOnly />
    </div>
  );
}

type Layout = "edit" | "split" | "preview";

interface CdnTextEditorProps {
  fileId: string;
  filename: string;
  mimeType: string;
  content: string;
  loading: boolean;
  saving: boolean;
  readOnly?: boolean;
  notice?: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function CdnTextEditor({
  filename,
  content,
  loading,
  saving,
  readOnly = false,
  notice,
  onChange,
  onSave,
  onClose,
}: CdnTextEditorProps) {
  const { t } = useI18n();
  const kind = previewKind(filename);
  const [layout, setLayout] = useState<Layout>(() => {
    if (!kind) return "edit";
    if (readOnly) return "preview";
    return typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
      ? "split"
      : "edit";
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!readOnly) onSave();
      }
    },
    [onSave, readOnly],
  );

  const layouts: [Layout, typeof faCode, string][] = [
    ["edit", faCode, "Editor"],
    ["split", faTableColumns, "Side by side"],
    ["preview", faEye, "Preview"],
  ];

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="status-badge bg-white/5 font-mono text-ink-dim">
            {t(languageLabel(filename))}
          </span>
          {readOnly && (
            <span className="status-badge bg-white/5 text-ink-dim">
              <Icon icon={faLock} className="text-[10px]" />
              {t("Read only")}
            </span>
          )}
        </div>
        {kind && (
          <div className="view-toggle" role="group" aria-label={t("View")}>
            {layouts.map(([mode, icon, label]) => (
              <button
                key={mode}
                onClick={() => setLayout(mode)}
                aria-pressed={layout === mode}
                aria-label={t(label)}
                title={t(label)}
                className={mode === "split" ? "max-lg:hidden" : undefined}
              >
                <Icon icon={icon} />
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && (
        <p className="rounded-card bg-accent-soft px-3 py-2 text-[13px] text-accent-ink">
          {t(notice)}
        </p>
      )}

      {/* Editor / Preview area */}
      {loading ? (
        <div className="flex h-64 items-center justify-center gap-3 text-ink-faint">
          <Icon icon={faRotateRight} className="animate-spin" />
          <span className="text-sm">{t("Loading file…")}</span>
        </div>
      ) : kind && layout === "preview" ? (
        <RenderedPreview kind={kind} content={content} className="editor-area" />
      ) : kind && layout === "split" ? (
        <div className="editor-area editor-split grid grid-cols-2 gap-3">
          <div className="min-h-0">
            <EditorWithLang
              value={content}
              onChange={onChange}
              filename={filename}
              readOnly={readOnly}
              fill
            />
          </div>
          <RenderedPreview kind={kind} content={content} className="h-full" />
        </div>
      ) : (
        <EditorWithLang
          value={content}
          onChange={onChange}
          filename={filename}
          readOnly={readOnly}
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-faint max-sm:hidden">
          {!readOnly && (
            <>
              <kbd className="rounded bg-white/5 px-1 py-0.5 text-[10px]">
                Ctrl+S
              </kbd>{" "}
              {t("to save")}
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} className="secondary-button">
            {t(readOnly ? "Close" : "Cancel")}
          </button>
          {!readOnly && (
            <button
              onClick={onSave}
              disabled={saving || loading}
              className="primary-button disabled:opacity-50"
            >
              <Icon
                icon={saving ? faRotateRight : faFloppyDisk}
                className={saving ? "animate-spin" : undefined}
              />
              {saving ? t("Saving…") : t("Save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
