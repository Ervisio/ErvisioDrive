// Browser-only OpenDocument Text <-> Markdown bridge.
// Supports headings, paragraphs, nested lists, bold, italic and links. Documents
// using anything else (tables, images, notes…) open read-only so saving never
// drops content.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { ODT_MIME } from "@/lib/text-files";

const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
};

// Elements we cannot round-trip through Markdown.
const UNSUPPORTED = ["table", "frame", "note", "object", "image", "annotation"];
// Top-level body elements the editor understands or safely keeps.
const KNOWN_BLOCKS = new Set(["p", "h", "list", "section", "sequence-decls", "soft-page-break", "forms"]);

export interface OdtDocument {
  markdown: string;
  /** Why the document cannot be saved from the editor, if it cannot. */
  readOnly: string | null;
  entries: Record<string, Uint8Array>;
}

interface TextStyle {
  bold: boolean;
  italic: boolean;
}

function textStyles(...docs: Document[]) {
  const styles = new Map<string, TextStyle>();
  for (const doc of docs)
    for (const el of Array.from(doc.getElementsByTagNameNS(NS.style, "style"))) {
      const props = el.getElementsByTagNameNS(NS.style, "text-properties")[0];
      if (!props) continue;
      styles.set(el.getAttributeNS(NS.style, "name") || "", {
        bold: props.getAttributeNS(NS.fo, "font-weight") === "bold",
        italic: props.getAttributeNS(NS.fo, "font-style") === "italic",
      });
    }
  return styles;
}

function numberedLists(...docs: Document[]) {
  const numbered = new Set<string>();
  for (const doc of docs)
    for (const el of Array.from(doc.getElementsByTagNameNS(NS.text, "list-style"))) {
      const first = el.firstElementChild;
      if (first?.localName === "list-level-style-number")
        numbered.add(el.getAttributeNS(NS.style, "name") || "");
    }
  return numbered;
}

const escapeMd = (value: string) => value.replace(/([\\*_`[\]])/g, "\\$1");

export function readOdt(bytes: Uint8Array): OdtDocument {
  const entries = unzipSync(bytes);
  if (!entries["content.xml"]) throw new Error("Invalid OpenDocument file");
  const parser = new DOMParser(),
    content = parser.parseFromString(strFromU8(entries["content.xml"]), "application/xml"),
    styleDoc = entries["styles.xml"]
      ? parser.parseFromString(strFromU8(entries["styles.xml"]), "application/xml")
      : content,
    styles = textStyles(content, styleDoc),
    numbered = numberedLists(content, styleDoc),
    body = content.getElementsByTagNameNS(NS.office, "text")[0];
  if (!body) throw new Error("Invalid OpenDocument file");

  const unsupported =
    UNSUPPORTED.some((name) => body.getElementsByTagNameNS("*", name).length > 0) ||
    Array.from(body.children).some((el) => !KNOWN_BLOCKS.has(el.localName));

  const inline = (node: Node, inherited: TextStyle = { bold: false, italic: false }): string => {
    let out = "";
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += escapeMd(child.textContent || "");
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as Element;
      switch (el.localName) {
        case "s":
          out += " ".repeat(Number(el.getAttributeNS(NS.text, "c") || 1));
          break;
        case "tab":
          out += "\t";
          break;
        case "line-break":
          out += "  \n";
          break;
        case "frame":
          out += "*[image]*";
          break;
        case "note":
        case "annotation":
          break;
        case "a": {
          const href = el.getAttributeNS(NS.xlink, "href") || "";
          out += `[${inline(el, inherited)}](${href})`;
          break;
        }
        case "span": {
          const own = styles.get(el.getAttributeNS(NS.text, "style-name") || "");
          const style = {
            bold: inherited.bold || !!own?.bold,
            italic: inherited.italic || !!own?.italic,
          };
          let text = inline(el, style);
          const trimmed = text.trim();
          if (trimmed) {
            const mark =
              (style.bold && !inherited.bold ? "**" : "") +
              (style.italic && !inherited.italic ? "*" : "");
            if (mark)
              text = text.replace(trimmed, mark + trimmed + [...mark].reverse().join(""));
          }
          out += text;
          break;
        }
        default:
          out += inline(el, inherited);
      }
    });
    return out;
  };

  const blocks: string[] = [];
  const list = (el: Element, depth: number, ordered: boolean) => {
    const name = el.getAttributeNS(NS.text, "style-name");
    if (name) ordered = numbered.has(name);
    let index = 1;
    for (const item of Array.from(el.children)) {
      if (item.localName !== "list-item" && item.localName !== "list-header") continue;
      let first = true;
      for (const part of Array.from(item.children)) {
        if (part.localName === "list") list(part, depth + 1, ordered);
        else if (part.localName === "p" || part.localName === "h") {
          const prefix = first ? (ordered ? `${index}. ` : "- ") : "  ";
          blocks.push("  ".repeat(depth) + prefix + inline(part));
          first = false;
        }
      }
      index++;
    }
  };
  // Tables only appear in read-only documents, rendered as GFM for the preview.
  const table = (el: Element) => {
    const rows = Array.from(el.getElementsByTagNameNS(NS.table, "table-row")).map((row) =>
      Array.from(row.getElementsByTagNameNS(NS.table, "table-cell")).map((cell) =>
        Array.from(cell.children)
          .map((part) => inline(part))
          .join(" ")
          .replace(/\|/g, "\\|")
          .replace(/\n/g, " "),
      ),
    );
    if (!rows.length) return;
    const width = Math.max(...rows.map((row) => row.length));
    const line = (cells: string[]) =>
      "| " + Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ") + " |";
    blocks.push(
      "\n" +
        [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n") +
        "\n",
    );
  };
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      if (el.namespaceURI === NS.table && el.localName === "table") table(el);
      if (el.namespaceURI !== NS.text) continue;
      if (el.localName === "h") {
        const level = Math.min(6, Number(el.getAttributeNS(NS.text, "outline-level") || 1));
        blocks.push("\n" + "#".repeat(level) + " " + inline(el) + "\n");
      } else if (el.localName === "p") blocks.push("\n" + inline(el) + "\n");
      else if (el.localName === "list") {
        blocks.push("");
        list(el, 0, false);
        blocks.push("");
      } else if (el.localName === "section") walk(el);
    }
  };
  walk(body);

  return {
    markdown: blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
    readOnly: unsupported
      ? "This document contains tables, images or notes and opens read-only."
      : null,
    entries,
  };
}

/* ── Markdown → ODT ─────────────────────────────────────────────────────────── */

const STYLE_BOLD = "EDBold",
  STYLE_ITALIC = "EDItalic",
  STYLE_BOTH = "EDBoldItalic",
  LIST_BULLET = "EDBullet",
  LIST_NUMBER = "EDNumber";

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; depth: number; ordered: boolean; text: string };

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/),
      item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
    } else if (item) {
      flush();
      blocks.push({
        kind: "li",
        depth: Math.floor(item[1].replace(/\t/g, "  ").length / 2),
        ordered: /\d/.test(item[2]),
        text: item[3],
      });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

function appendInline(doc: Document, parent: Element, source: string) {
  const el = (name: string) => doc.createElementNS(NS.text, `text:${name}`);
  // Tokens: escapes, links, ***both***, **bold**, *italic* / _italic_, hard breaks.
  const pattern =
    /\\([\\*_`[\]])|\[([^\]]*)\]\(([^)\s]*)\)|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<![\w*])[*_](.+?)[*_](?![\w*])| {2,}\n|\n/g;
  const text = (target: Element, value: string) => {
    // Keep runs of spaces and tabs visible, as ODT collapses them.
    value.split(/(\t| {2,})/).forEach((part) => {
      if (!part) return;
      if (part === "\t") target.appendChild(el("tab"));
      else if (/^ {2,}$/.test(part)) {
        target.appendChild(doc.createTextNode(" "));
        const s = el("s");
        s.setAttributeNS(NS.text, "text:c", String(part.length - 1));
        target.appendChild(s);
      } else target.appendChild(doc.createTextNode(part));
    });
  };
  const styled = (style: string, value: string) => {
    const span = el("span");
    span.setAttributeNS(NS.text, "text:style-name", style);
    appendInline(doc, span, value);
    parent.appendChild(span);
  };
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    text(parent, source.slice(last, match.index));
    last = match.index! + match[0].length;
    const [token, escaped, label, href, both, bold, italic] = match;
    if (escaped) parent.appendChild(doc.createTextNode(escaped));
    else if (label !== undefined) {
      const a = el("a");
      a.setAttributeNS(NS.xlink, "xlink:type", "simple");
      a.setAttributeNS(NS.xlink, "xlink:href", href);
      appendInline(doc, a, label);
      parent.appendChild(a);
    } else if (both) styled(STYLE_BOTH, both);
    else if (bold) styled(STYLE_BOLD, bold);
    else if (italic) styled(STYLE_ITALIC, italic);
    else if (token.includes("\n") && token.startsWith("  ")) parent.appendChild(el("line-break"));
    else parent.appendChild(doc.createTextNode(" "));
  }
  text(parent, source.slice(last));
}

function ensureStyles(doc: Document) {
  const root = doc.documentElement;
  let auto = doc.getElementsByTagNameNS(NS.office, "automatic-styles")[0];
  if (!auto) {
    auto = doc.createElementNS(NS.office, "office:automatic-styles");
    const body = doc.getElementsByTagNameNS(NS.office, "body")[0];
    root.insertBefore(auto, body ?? null);
  }
  const existing = new Set(
    Array.from(auto.children).map((el) => el.getAttributeNS(NS.style, "name")),
  );
  const textStyle = (name: string, bold: boolean, italic: boolean) => {
    if (existing.has(name)) return;
    const style = doc.createElementNS(NS.style, "style:style");
    style.setAttributeNS(NS.style, "style:name", name);
    style.setAttributeNS(NS.style, "style:family", "text");
    const props = doc.createElementNS(NS.style, "style:text-properties");
    for (const suffix of ["", "-asian", "-complex"]) {
      if (bold)
        props.setAttributeNS(
          suffix ? NS.style : NS.fo,
          suffix ? `style:font-weight${suffix}` : "fo:font-weight",
          "bold",
        );
      if (italic)
        props.setAttributeNS(
          suffix ? NS.style : NS.fo,
          suffix ? `style:font-style${suffix}` : "fo:font-style",
          "italic",
        );
    }
    style.appendChild(props);
    auto.appendChild(style);
  };
  textStyle(STYLE_BOLD, true, false);
  textStyle(STYLE_ITALIC, false, true);
  textStyle(STYLE_BOTH, true, true);
  const listStyle = (name: string, ordered: boolean) => {
    if (existing.has(name)) return;
    const style = doc.createElementNS(NS.text, "text:list-style");
    style.setAttributeNS(NS.style, "style:name", name);
    for (let level = 1; level <= 10; level++) {
      const levelStyle = doc.createElementNS(
        NS.text,
        ordered ? "text:list-level-style-number" : "text:list-level-style-bullet",
      );
      levelStyle.setAttributeNS(NS.text, "text:level", String(level));
      if (ordered) {
        levelStyle.setAttributeNS(NS.style, "style:num-format", "1");
        levelStyle.setAttributeNS(NS.style, "style:num-suffix", ".");
      } else levelStyle.setAttributeNS(NS.text, "text:bullet-char", "•");
      const props = doc.createElementNS(NS.style, "style:list-level-properties");
      props.setAttributeNS(NS.style, "style:list-level-position-and-space-mode", "label-alignment");
      const align = doc.createElementNS(NS.style, "style:list-level-label-alignment");
      align.setAttributeNS(NS.text, "text:label-followed-by", "listtab");
      align.setAttributeNS(NS.fo, "fo:text-indent", "-0.635cm");
      align.setAttributeNS(NS.fo, "fo:margin-left", `${(0.635 * (level + 1)).toFixed(3)}cm`);
      props.appendChild(align);
      levelStyle.appendChild(props);
      style.appendChild(levelStyle);
    }
    auto.appendChild(style);
  };
  listStyle(LIST_BULLET, false);
  listStyle(LIST_NUMBER, true);
}

export function writeOdt(original: OdtDocument, markdown: string): Uint8Array {
  const doc = new DOMParser().parseFromString(
    strFromU8(original.entries["content.xml"]),
    "application/xml",
  );
  const body = doc.getElementsByTagNameNS(NS.office, "text")[0];
  if (!body) throw new Error("Invalid OpenDocument file");
  // Drop the old text flow, keep declarations such as sequence-decls and forms.
  for (const el of Array.from(body.children))
    if (el.namespaceURI === NS.text && ["p", "h", "list", "section"].includes(el.localName))
      el.remove();
  ensureStyles(doc);

  const el = (name: string) => doc.createElementNS(NS.text, `text:${name}`);
  // Open lists per depth while consecutive items arrive.
  let lists: Element[] = [];
  for (const block of parseMarkdown(markdown)) {
    if (block.kind !== "li") {
      lists = [];
      const node = el(block.kind === "h" ? "h" : "p");
      if (block.kind === "h") {
        node.setAttributeNS(NS.text, "text:style-name", `Heading_20_${block.level}`);
        node.setAttributeNS(NS.text, "text:outline-level", String(block.level));
      } else node.setAttributeNS(NS.text, "text:style-name", "Standard");
      appendInline(doc, node, block.text);
      body.appendChild(node);
      continue;
    }
    const depth = Math.min(block.depth, lists.length);
    lists = lists.slice(0, depth + 1);
    if (!lists[depth]) {
      const list = el("list");
      if (depth === 0) {
        list.setAttributeNS(NS.text, "text:style-name", block.ordered ? LIST_NUMBER : LIST_BULLET);
        body.appendChild(list);
      } else {
        const parentItem = lists[depth - 1].lastElementChild ?? lists[depth - 1].appendChild(el("list-item"));
        parentItem.appendChild(list);
      }
      lists[depth] = list;
    }
    const item = el("list-item"),
      p = el("p");
    p.setAttributeNS(NS.text, "text:style-name", "Standard");
    appendInline(doc, p, block.text);
    item.appendChild(p);
    lists[depth].appendChild(item);
  }

  const files: Zippable = {
    // The mimetype entry must come first and stay uncompressed.
    mimetype: [strToU8(ODT_MIME), { level: 0 }],
  };
  for (const [name, data] of Object.entries(original.entries))
    if (name !== "mimetype")
      files[name] =
        name === "content.xml"
          ? strToU8(new XMLSerializer().serializeToString(doc))
          : data;
  return zipSync(files, { level: 6 });
}

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
export const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
