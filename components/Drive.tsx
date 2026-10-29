"use client";
import { useI18n } from "@/components/LocaleProvider";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { FolderAccess } from "@/components/FolderAccess";
import { request } from "@/lib/client-request";
import { Icon } from "@/components/ui/Icon";
import {
  faHardDrive,
  faUpload,
  faTrash,
  faCopy,
  faLink,
  faPen,
  faDownload,
  faImage,
  faFilm,
  faMusic,
  faFile,
  faFolder,
  faFolderPlus,
  faFolderOpen,
  faXmark,
  faCheck,
  faEye,
  faLock,
  faCalendar,
  faHashtag,
  faTableCells,
  faList,
  faSearch,
  faClockRotateLeft,
  faRotateRight,
  faUsers,
  faBook,
  faPlus,
  faUserMinus,
  faArrowLeft,
  faCircleInfo,
  faUser,
  faSort,
  faFileCode,
  faArrowsAlt,
  faAnglesLeft,
  faAnglesRight,
  faTableCellsLarge,
  faEllipsisVertical,
  faPenToSquare,
  faUpRightAndDownLeftFromCenter,
  faDownLeftAndUpRightToCenter,
} from "@fortawesome/free-solid-svg-icons";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { AdminModal } from "@/components/admin/AdminModal";
import { formatBytes } from "@/lib/format";
import {
  CdnTextEditor,
  TextPreview,
  isEditableTextFile,
  useEditorLayout,
} from "@/components/admin/cdn/CdnTextEditor";
import {
  FileMenu,
  anchorFromElement,
  type FileMenuItem,
  type MenuAnchor,
} from "@/components/FileMenu";
import { isOdtFile } from "@/lib/text-files";
import type { OdtDocument } from "@/lib/odt";

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface CdnFileItem {
  _id: string;
  name: string;
  storedName: string;
  folder: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedByUsername: string;
  expiresAt: string | null;
  createdAt: string;
}

interface ShareToken {
  _id: string;
  token: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: string;
}

interface CdnFolderItem {
  _id: string;
  slug: string;
  name: string;
  description: string;
  allowedUsers: string[];
  createdAt: string;
}

interface AccessUser {
  id: string;
  username: string;
  email: string;
}

type FolderCounts = Record<string, number>;
type ViewMode = "grid" | "list" | "details";
type SortField =
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc"
  | "date-desc"
  | "date-asc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "name-asc", label: "A → Z" },
  { value: "name-desc", label: "Z → A" },
  { value: "size-desc", label: "Size (descending)" },
  { value: "size-asc", label: "Size (ascending)" },
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
];

const BUILTIN_FOLDERS = [
  { slug: "all", label: "All", icon: faFolder },
  { slug: "images", label: "Images", icon: faImage },
  { slug: "videos", label: "Video", icon: faFilm },
  { slug: "audio", label: "Audio", icon: faMusic },
  { slug: "documents", label: "Documents", icon: faFile },
  { slug: "other", label: "Other", icon: faFile },
] as const;

const fetcher = (url: string) => request(url).then((r) => r.json());

/* ─── File icon ───────────────────────────────────────────────────────────── */
function FileTypeIcon({
  mimeType,
  className = "",
}: {
  mimeType: string;
  className?: string;
}) {
  const { t, dateLocale } = useI18n();

  if (mimeType.startsWith("image/"))
    return <Icon icon={faImage} className={`text-blue-500 ${className}`} />;
  if (mimeType.startsWith("video/"))
    return <Icon icon={faFilm} className={`text-media ${className}`} />;
  if (mimeType.startsWith("audio/"))
    return <Icon icon={faMusic} className={`text-emerald-500 ${className}`} />;
  return <Icon icon={faFile} className={`text-ink-dim ${className}`} />;
}

/* ─── File thumbnail ──────────────────────────────────────────────────────── */
function FileThumbnail({
  file,
  small = false,
}: {
  file: CdnFileItem;
  small?: boolean;
}) {
  const { t, dateLocale } = useI18n();

  if (file.mimeType.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.url}
        alt={file.name}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <FileTypeIcon
        mimeType={file.mimeType}
        className={small ? "text-[15px]" : "text-5xl opacity-25"}
      />
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */
export default function CdnPage() {
  const { t, dateLocale } = useI18n();

  const [folderAccess, setFolderAccess] = useState<CdnFolderItem | null>(null);
  const [moveSelectFile, setMoveSelectFile] = useState<CdnFileItem | null>(
    null,
  );
  const [moveDestination, setMoveDestination] = useState("");
  function openMove(file: CdnFileItem) {
    setMoveSelectFile(file);
    setMoveDestination(file.folder);
  }
  // The active folder lives in the URL so the shell rail can link to folders.
  const router = useRouter(),
    params = useSearchParams();
  const activeFolder = params.get("folder") || "all",
    owner = params.get("owner"),
    scope = (params.get("scope") as "mine" | "shared" | null) || "all";
  // Folder, scope and the admin's "browse a member" owner share the URL.
  const navigate = useCallback(
    (next: { folder?: string; scope?: string; owner?: string | null }) => {
      const query = new URLSearchParams();
      const folder = next.folder ?? activeFolder,
        nextOwner = next.owner === undefined ? owner : next.owner,
        nextScope = next.scope ?? scope;
      if (folder !== "all") query.set("folder", folder);
      if (nextOwner) query.set("owner", nextOwner);
      else if (nextScope !== "all") query.set("scope", nextScope);
      const text = query.toString();
      router.replace(text ? `/?${text}` : "/", { scroll: false });
    },
    [router, activeFolder, owner, scope],
  );
  const setActiveFolder = useCallback(
    (slug: string) => navigate({ folder: slug }),
    [navigate],
  );
  const { data: ownerData } = useSWR(owner ? "/api/admin/members" : null, fetcher);
  const ownerMember = ownerData?.data?.find(
    (member: { _id: string }) => member._id === owner,
  ) as { name: string; email: string } | undefined;
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSearchSlot(document.getElementById("shell-search"));
    try {
      setPanelCollapsed(localStorage.getItem("drive-panel") === "collapsed");
      const saved = localStorage.getItem("drive-view");
      if (saved === "grid" || saved === "list" || saved === "details")
        setViewMode(saved);
    } catch {}
  }, []);
  useEffect(() => {
    if (!newMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!newMenuRef.current?.contains(event.target as Node))
        setNewMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [newMenuOpen]);
  const togglePanel = (collapsed: boolean) => {
    setPanelCollapsed(collapsed);
    try {
      localStorage.setItem("drive-panel", collapsed ? "collapsed" : "open");
    } catch {}
  };
  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("drive-view", mode);
    } catch {}
  };
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("date-desc");

  // Custom folder creation
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [folderCreateName, setFolderCreateName] = useState("");
  const [folderCreateDesc, setFolderCreateDesc] = useState("");
  const [folderCreateLoading, setFolderCreateLoading] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(
    null,
  );

  // Folder delete
  const [folderDeleteTarget, setFolderDeleteTarget] =
    useState<CdnFolderItem | null>(null);
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(
    null,
  );

  // File access management
  const [accessFile, setAccessFile] = useState<CdnFileItem | null>(null);
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [accessIsPublic, setAccessIsPublic] = useState(true);
  const [accessAddInput, setAccessAddInput] = useState("");
  const [accessAddLoading, setAccessAddLoading] = useState(false);
  const [accessAddError, setAccessAddError] = useState<string | null>(null);

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [uploadExpiresIn, setUploadExpiresIn] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<
    Record<string, "pending" | "done" | "error">
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rename state
  const [renameFile, setRenameFile] = useState<CdnFileItem | null>(null);
  const [renameName, setRenameName] = useState("");

  // Delete confirm
  const [deleteFile, setDeleteFile] = useState<CdnFileItem | null>(null);

  // Preview
  const [previewFile, setPreviewFile] = useState<CdnFileItem | null>(null);

  // Details panel selection
  const [detailFile, setDetailFile] = useState<CdnFileItem | null>(null);

  // Share modal
  const [shareFile, setShareFile] = useState<CdnFileItem | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");
  const [shareCreating, setShareCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedDirect, setCopiedDirect] = useState(false);

  // Drag & drop to folder
  const [draggingFile, setDraggingFile] = useState<CdnFileItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    file: CdnFileItem;
    targetSlug: string;
    targetName: string;
  } | null>(null);

  // Text editor
  const [editTextFile, setEditTextFile] = useState<CdnFileItem | null>(null);
  const [textContent, setTextContent] = useState("");
  const [textContentLoading, setTextContentLoading] = useState(false);
  const [textContentSaving, setTextContentSaving] = useState(false);
  const [textNotice, setTextNotice] = useState<string | null>(null);
  const [editorLayout] = useEditorLayout();
  const [editorFull, setEditorFull] = useState(false);
  const [textReadOnly, setTextReadOnly] = useState(false);
  const odtDocument = useRef<OdtDocument | null>(null);
  // Read-only text shown by the preview modal.
  const [previewText, setPreviewText] = useState<string | null>(null);

  const buildUrl = () => {
    let url = `/api/admin/cdn/files?`;
    if (activeFolder !== "all") url += `folder=${activeFolder}&`;
    if (search.trim()) url += `search=${encodeURIComponent(search.trim())}&`;
    if (owner) url += `owner=${encodeURIComponent(owner)}&`;
    else if (scope !== "all") url += `scope=${scope}&`;
    return url;
  };

  const {
    data,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR(buildUrl(), fetcher, {
    revalidateOnFocus: true,
  });

  const files: CdnFileItem[] = data?.data ?? [];
  const folderCounts: FolderCounts = data?.folderCounts ?? {};

  // Sorted files
  const sortedFiles = useMemo<CdnFileItem[]>(() => {
    const arr = [...files];
    switch (sortBy) {
      case "name-asc":
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        arr.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "size-desc":
        arr.sort((a, b) => b.size - a.size);
        break;
      case "size-asc":
        arr.sort((a, b) => a.size - b.size);
        break;
      case "date-desc":
        arr.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        break;
      case "date-asc":
        arr.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        break;
    }
    return arr;
  }, [files, sortBy]);

  // Custom folders
  const { data: foldersData, mutate: mutateFolders } = useSWR<{
    data: CdnFolderItem[];
  }>("/api/admin/cdn/folders", fetcher);
  const customFolders: CdnFolderItem[] = foldersData?.data ?? [];

  const { data: shareData, mutate: mutateShare } = useSWR<{
    data: ShareToken[];
  }>(shareFile ? `/api/admin/cdn/files/${shareFile._id}/share` : null, fetcher);
  const shareTokens: ShareToken[] = shareData?.data ?? [];

  useEffect(() => {
    if (params.get("new") !== "folder") return;
    setFolderCreateOpen(true);
    setFolderCreateError(null);
    setActiveFolder(activeFolder);
  }, [params, activeFolder, setActiveFolder]);

  /* ── Upload ─────────────────────────────────────────────────────────────── */
  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setUploadQueue((q) => [...q, ...dropped]);
  }, []);

  const handleUploadSubmit = async () => {
    if (!uploadQueue.length) return;
    setUploading(true);
    const next: Record<string, "pending" | "done" | "error"> = {};
    uploadQueue.forEach((f) => (next[f.name] = "pending"));
    setUploadProgress(next);

    let failures = 0;
    for (const file of uploadQueue) {
      const fd = new FormData();
      fd.append("files", file);
      // Pass the active folder so custom-folder uploads land in the right place
      if (activeFolder !== "all") fd.append("folder", activeFolder);
      if (uploadExpiresIn) fd.append("expiresIn", uploadExpiresIn);
      try {
        const res = await request("/api/admin/cdn/upload", {
          method: "POST",
          body: fd,
        });
        setUploadProgress((p) => ({
          ...p,
          [file.name]: res.ok ? "done" : "error",
        }));
      } catch {
        failures++;
        setUploadProgress((p) => ({ ...p, [file.name]: "error" }));
      }
    }

    setUploading(false);
    // Switch to the appropriate folder so newly uploaded files are immediately visible:
    // custom folder → stay there; builtin / all → go to 'all' (MIME detection chooses folder)
    const BUILTINS = new Set([
      "images",
      "videos",
      "audio",
      "documents",
      "other",
    ]);
    if (!BUILTINS.has(activeFolder)) {
      // Already in the custom folder — stay and mutate
    } else {
      setActiveFolder("all");
    }
    mutate();
    if (failures) return;
    setTimeout(() => {
      setUploadOpen(false);
      setUploadQueue([]);
      setUploadProgress({});
      setUploadExpiresIn("");
    }, 1200);
  };

  /* ── Custom folder create ────────────────────────────────────────────────── */
  const handleFolderCreate = async () => {
    setFolderCreateError(null);
    if (!folderCreateName.trim()) return;
    setFolderCreateLoading(true);
    try {
      const res = await request("/api/admin/cdn/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderCreateName.trim(),
          description: folderCreateDesc.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      await mutateFolders();
      setFolderCreateOpen(false);
      setFolderCreateName("");
      setFolderCreateDesc("");
    } catch (err: any) {
      setFolderCreateError(err.message);
    } finally {
      setFolderCreateLoading(false);
    }
  };

  /* ── Custom folder delete ─────────────────────────────────────────────────── */
  const handleFolderDelete = async () => {
    if (!folderDeleteTarget) return;
    setFolderDeleteError(null);
    const res = await request(
      `/api/admin/cdn/folders/${folderDeleteTarget.slug}`,
      { method: "DELETE" },
    );
    const json = await res.json();
    if (!json.success) {
      setFolderDeleteError(json.error);
      return;
    }
    if (activeFolder === folderDeleteTarget.slug) setActiveFolder("all");
    await mutateFolders();
    setFolderDeleteTarget(null);
  };

  /* ── File access management ───────────────────────────────────────────────── */
  const openAccessModal = async (file: CdnFileItem) => {
    setAccessFile(file);
    setAccessAddInput("");
    setAccessAddError(null);
    const res = await request(`/api/admin/cdn/files/${file._id}/access`);
    const json = await res.json();
    if (json.success) {
      setAccessUsers(json.allowedUsers ?? []);
      setAccessIsPublic(json.isPublic);
    }
  };

  const handleAccessAdd = async () => {
    if (!accessFile || !accessAddInput.trim()) return;
    setAccessAddLoading(true);
    setAccessAddError(null);
    try {
      const res = await request(
        `/api/admin/cdn/files/${accessFile._id}/access`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: accessAddInput.trim() }),
        },
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      // Refresh list
      const r2 = await request(`/api/admin/cdn/files/${accessFile._id}/access`);
      const j2 = await r2.json();
      setAccessUsers(j2.allowedUsers ?? []);
      setAccessIsPublic(j2.isPublic);
      setAccessAddInput("");
    } catch (err: any) {
      setAccessAddError(err.message);
    } finally {
      setAccessAddLoading(false);
    }
  };

  const setFileVisibility = async (visibility: "private" | "members") => {
    if (!accessFile) return;
    setAccessIsPublic(visibility === "members");
    await request(`/api/admin/cdn/files/${accessFile._id}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    mutate();
  };

  const handleAccessRevoke = async (userId: string) => {
    if (!accessFile) return;
    await request(`/api/admin/cdn/files/${accessFile._id}/access`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const r2 = await request(`/api/admin/cdn/files/${accessFile._id}/access`);
    const j2 = await r2.json();
    setAccessUsers(j2.allowedUsers ?? []);
    setAccessIsPublic(j2.isPublic);
  };

  /* ── Rename ─────────────────────────────────────────────────────────────── */
  const handleRename = async () => {
    if (!renameFile || !renameName.trim()) return;
    await request(`/api/admin/cdn/files/${renameFile._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameName.trim() }),
    });
    mutate();
    setRenameFile(null);
  };

  /* ── Delete ─────────────────────────────────────────────────────────────── */
  const handleDelete = async () => {
    if (!deleteFile) return;
    await request(`/api/admin/cdn/files/${deleteFile._id}`, {
      method: "DELETE",
    });
    mutate();
    setDeleteFile(null);
  };

  /* ── Copy (duplicate) ───────────────────────────────────────────────────── */
  const handleCopy = async (file: CdnFileItem) => {
    await request(`/api/admin/cdn/files/${file._id}/copy`, { method: "POST" });
    mutate();
  };

  /* ── Move file to folder ────────────────────────────────────────────────── */
  const handleMoveFile = async () => {
    if (!moveConfirm) return;
    await request(`/api/admin/cdn/files/${moveConfirm.file._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: moveConfirm.targetSlug }),
    });
    mutate();
    mutateFolders();
    setMoveConfirm(null);
    setDraggingFile(null);
    setDragOverFolder(null);
  };

  /* ── Text file editor ───────────────────────────────────────────────────── */
  // OpenDocument files arrive as base64 and are edited as Markdown.
  const loadText = async (file: CdnFileItem) => {
    const res = await request(`/api/admin/cdn/files/${file._id}/content`);
    const json = await res.json();
    if (!json.success) return null;
    if (json.encoding !== "base64") return { text: json.content as string };
    const { readOdt, base64ToBytes } = await import("@/lib/odt");
    const doc = readOdt(base64ToBytes(json.content));
    return { text: doc.markdown, odt: doc };
  };

  const openTextEditor = async (file: CdnFileItem) => {
    setEditTextFile(file);
    setEditorFull(false);
    setTextContentLoading(true);
    setTextContent("");
    setTextReadOnly(false);
    odtDocument.current = null;
    setTextNotice(
      isOdtFile(file.name, file.mimeType)
        ? "OpenDocument files are edited as Markdown: headings, lists, bold, italic and links are kept."
        : null,
    );
    try {
      const loaded = await loadText(file);
      if (loaded) {
        setTextContent(loaded.text);
        odtDocument.current = loaded.odt ?? null;
        if (loaded.odt?.readOnly) {
          setTextReadOnly(true);
          setTextNotice(loaded.odt.readOnly);
        }
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent("drive-error", { detail: "Invalid OpenDocument file" }),
      );
      setEditTextFile(null);
    } finally {
      setTextContentLoading(false);
    }
  };

  const handleSaveTextContent = async () => {
    if (!editTextFile || textReadOnly) return;
    setTextContentSaving(true);
    try {
      let body: Record<string, string> = { content: textContent };
      if (odtDocument.current) {
        const { writeOdt, bytesToBase64 } = await import("@/lib/odt");
        body = {
          content: bytesToBase64(writeOdt(odtDocument.current, textContent)),
          encoding: "base64",
        };
      }
      await request(`/api/admin/cdn/files/${editTextFile._id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      mutate();
      setEditTextFile(null);
    } finally {
      setTextContentSaving(false);
    }
  };

  useEffect(() => {
    setPreviewText(null);
    if (!previewFile || !isEditableTextFile(previewFile.name, previewFile.mimeType))
      return;
    let alive = true;
    loadText(previewFile)
      .then((loaded) => alive && setPreviewText(loaded?.text ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFile]);

  /* ── Drag & drop helpers ────────────────────────────────────────────────── */
  const handleFileDragStart = useCallback(
    (file: CdnFileItem) => setDraggingFile(file),
    [],
  );
  const handleFileDragEnd = useCallback(() => {
    setDraggingFile(null);
    setDragOverFolder(null);
  }, []);

  const handleFolderDragOver = useCallback(
    (e: React.DragEvent, slug: string) => {
      e.preventDefault();
      setDragOverFolder(slug);
    },
    [],
  );

  const handleFolderDragLeave = useCallback(() => setDragOverFolder(null), []);

  const handleFolderDrop = useCallback(
    (e: React.DragEvent, slug: string, name: string) => {
      e.preventDefault();
      setDragOverFolder(null);
      if (!draggingFile) return;
      if (draggingFile.folder === slug) return; // Already in this folder
      setMoveConfirm({
        file: draggingFile,
        targetSlug: slug,
        targetName: name,
      });
    },
    [draggingFile],
  );

  /* ── Share ───────────────────────────────────────────────────────────────── */
  const handleCreateShare = async () => {
    if (!shareFile) return;
    setShareCreating(true);
    try {
      await request(`/api/admin/cdn/files/${shareFile._id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: sharePassword || undefined,
          expiresAt: shareExpiry
            ? new Date(shareExpiry).toISOString()
            : undefined,
          maxDownloads: shareMaxDownloads
            ? parseInt(shareMaxDownloads, 10)
            : undefined,
        }),
      });
      setSharePassword("");
      setShareExpiry("");
      setShareMaxDownloads("");
      mutateShare();
    } finally {
      setShareCreating(false);
    }
  };

  const handleRevokeToken = async (token: string) => {
    await request(`/api/admin/cdn/share/${token}`, { method: "DELETE" });
    mutateShare();
  };

  const copyToClipboard = (token: string) => {
    const url = `${window.location.origin}/api/download/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const copyDirectLink = () => {
    if (!shareFile) return;
    navigator.clipboard.writeText(`${window.location.origin}${shareFile.url}`);
    setCopiedDirect(true);
    setTimeout(() => setCopiedDirect(false), 2000);
  };

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="min-w-0 lg:pb-4">
      {folderAccess && (
        <FolderAccess
          slug={folderAccess.slug}
          name={folderAccess.name}
          onClose={() => {
            setFolderAccess(null);
            mutateFolders();
          }}
        />
      )}
      <AdminModal
        open={!!moveSelectFile}
        title={t("Move file")}
        onClose={() => setMoveSelectFile(null)}
        size="md"
      >
        <div className="space-y-4">
          <p className="break-all text-sm text-ink-dim">
            {moveSelectFile?.name}
          </p>
          <label className="field-label">
            {t("Destination folder")}
            <select
              className="field"
              value={moveDestination}
              onChange={(e) => setMoveDestination(e.target.value)}
            >
              {BUILTIN_FOLDERS.filter((f) => f.slug !== "all").map((folder) => (
                <option key={folder.slug} value={folder.slug}>
                  {t(folder.label)}
                </option>
              ))}
              {customFolders.map((folder) => (
                <option key={folder.slug} value={folder.slug}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button w-full"
            disabled={
              !moveSelectFile || moveDestination === moveSelectFile.folder
            }
            onClick={() => {
              if (!moveSelectFile) return;
              setMoveConfirm({
                file: moveSelectFile,
                targetSlug: moveDestination,
                targetName:
                  customFolders.find((f) => f.slug === moveDestination)?.name ||
                  t(
                    BUILTIN_FOLDERS.find((f) => f.slug === moveDestination)
                      ?.label || moveDestination,
                  ),
              });
              setMoveSelectFile(null);
            }}
          >
            {t("Move")}
          </button>
        </div>
      </AdminModal>
      {/* Search lives in the shell header */}
      {searchSlot &&
        createPortal(
          <label className="search-pill drive-search w-full">
            <Icon icon={faSearch} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search files…")}
              aria-label={t("Search files…")}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={t("Clear search")}
                className="icon-button -mr-2 h-9 w-9"
              >
                <Icon icon={faXmark} />
              </button>
            )}
          </label>,
          searchSlot,
        )}

      <div className={`drive-layout ${panelCollapsed ? "panel-collapsed" : ""}`}>
        {/* Folder panel (collapsible) */}
        <aside className="drive-panel" aria-label={t("Folders")}>
          <div className="drive-panel-inner">
            <div className="flex h-12 items-center justify-between pl-3 pr-1">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{t("My drive")}</p>
                <p className="text-xs text-ink-faint">
                  {folderCounts.all ?? 0}{" "}
                  {t((folderCounts.all ?? 0) === 1 ? "file" : "files")}{" "}
                  {t("total")}
                </p>
              </div>
              <button
                onClick={() => togglePanel(true)}
                aria-label={t("Collapse folders")}
                title={t("Collapse folders")}
                className="icon-button"
              >
                <Icon icon={faAnglesLeft} />
              </button>
            </div>
            <div className="relative my-2 ml-1" ref={newMenuRef}>
              <button
                className="new-button"
                onClick={() => setNewMenuOpen((open) => !open)}
                aria-expanded={newMenuOpen}
              >
                <Icon icon={faPlus} />
                {t("New")}
              </button>
              {newMenuOpen && (
                <div className="menu-popover left-0 top-[60px]">
                  <button
                    onClick={() => {
                      setNewMenuOpen(false);
                      setUploadOpen(true);
                    }}
                  >
                    <Icon icon={faUpload} className="w-4 text-ink-dim" />
                    {t("Upload files")}
                  </button>
                  <button
                    onClick={() => {
                      setNewMenuOpen(false);
                      setFolderCreateOpen(true);
                      setFolderCreateError(null);
                    }}
                  >
                    <Icon icon={faFolderPlus} className="w-4 text-ink-dim" />
                    {t("New folder")}
                  </button>
                </div>
              )}
            </div>
            <nav className="mt-1 space-y-0.5">
              {BUILTIN_FOLDERS.map((tab) => (
                <button
                  key={tab.slug}
                  onClick={() => setActiveFolder(tab.slug)}
                  onDragOver={(e) => handleFolderDragOver(e, tab.slug)}
                  onDragLeave={handleFolderDragLeave}
                  onDrop={(e) => handleFolderDrop(e, tab.slug, tab.label)}
                  aria-current={activeFolder === tab.slug ? "true" : undefined}
                  className={`panel-item ${activeFolder === tab.slug ? "active" : ""} ${dragOverFolder === tab.slug && draggingFile ? "drop" : ""}`}
                >
                  <Icon icon={tab.icon} />
                  <span className="truncate">{t(tab.label)}</span>
                  <em>{folderCounts[tab.slug] ?? 0}</em>
                </button>
              ))}
            </nav>
            <div className="mt-4 flex h-9 items-center justify-between pl-3.5 pr-1 text-[13px] font-semibold text-ink-dim">
              {t("Folders")}
              <button
                onClick={() => {
                  setFolderCreateOpen(true);
                  setFolderCreateError(null);
                }}
                aria-label={t("New folder")}
                title={t("New folder")}
                className="icon-button h-8 w-8 text-[13px]"
              >
                <Icon icon={faFolderPlus} />
              </button>
            </div>
            <div className="space-y-0.5">
              {customFolders.map((cf) => (
                <div key={cf.slug} className="group relative">
                  <button
                    onClick={() => setActiveFolder(cf.slug)}
                    onDragOver={(e) => handleFolderDragOver(e, cf.slug)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleFolderDrop(e, cf.slug, cf.name)}
                    aria-current={activeFolder === cf.slug ? "true" : undefined}
                    className={`panel-item pr-20 ${activeFolder === cf.slug ? "active" : ""} ${dragOverFolder === cf.slug && draggingFile ? "drop" : ""}`}
                  >
                    <Icon icon={cf.allowedUsers.length > 0 ? faLock : faFolder} />
                    <span className="truncate">{cf.name}</span>
                  </button>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint group-focus-within:opacity-0 group-hover:opacity-0">
                    {folderCounts[cf.slug] ?? 0}
                  </span>
                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => setFolderAccess(cf)}
                      title={t("Manage folder access")}
                      aria-label={t("Manage folder access")}
                      className="icon-button h-8 w-8 text-xs"
                    >
                      <Icon icon={faUsers} />
                    </button>
                    <button
                      onClick={() => setFolderDeleteTarget(cf)}
                      title={t("Delete folder")}
                      aria-label={t("Delete folder")}
                      className="icon-button h-8 w-8 text-xs hover:text-rose-500"
                    >
                      <Icon icon={faTrash} />
                    </button>
                  </div>
                </div>
              ))}
              {customFolders.length === 0 && (
                <p className="px-3.5 py-2 text-xs text-ink-faint">{t("No folders")}</p>
              )}
            </div>
          </div>
        </aside>

        <section className="drive-sheet drive-page flex min-w-0 flex-col gap-4">
          {/* Title row */}
          <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-2">
            {panelCollapsed && (
              <button
                onClick={() => togglePanel(false)}
                aria-label={t("Show folders")}
                title={t("Show folders")}
                className="icon-button hidden lg:grid"
              >
                <Icon icon={faAnglesRight} />
              </button>
            )}
            {(() => {
              const currentCf = customFolders.find((cf) => cf.slug === activeFolder);
              const builtin = BUILTIN_FOLDERS.find((f) => f.slug === activeFolder);
              return (
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {currentCf && (
                      <button
                        onClick={() => setActiveFolder("all")}
                        aria-label={t("Go back")}
                        title={t("Go back")}
                        className="icon-button -ml-2"
                      >
                        <Icon icon={faArrowLeft} />
                      </button>
                    )}
                    <h1 className="truncate text-[22px] font-medium tracking-tight">
                      {currentCf
                        ? currentCf.name
                        : builtin && builtin.slug !== "all"
                          ? t(builtin.label)
                          : t("My drive")}
                    </h1>
                    {currentCf && currentCf.allowedUsers.length > 0 && (
                      <Icon icon={faLock} className="text-xs text-ink-faint" />
                    )}
                  </div>
                  {currentCf?.description && (
                    <p className="truncate text-sm text-ink-faint">{currentCf.description}</p>
                  )}
                </div>
              );
            })()}
            <div className="drive-tools flex items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-ink-dim hover:bg-white/5">
                <Icon icon={faSort} className="text-xs" />
                <span className="sr-only">{t("Sort")}</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortField)}
                  aria-label={t("Sort")}
                  className="cursor-pointer bg-transparent font-medium outline-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="view-toggle" role="group" aria-label={t("View")}>
                {(
                  [
                    ["list", faList, "List view"],
                    ["grid", faTableCellsLarge, "Grid view"],
                    ["details", faCircleInfo, "Details view"],
                  ] as const
                ).map(([mode, icon, label]) => (
                  <button
                    key={mode}
                    onClick={() => changeView(mode)}
                    aria-pressed={viewMode === mode}
                    aria-label={t(label)}
                    title={t(label)}
                  >
                    {viewMode === mode && <Icon icon={faCheck} className="text-[11px]" />}
                    <Icon icon={icon} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {owner ? (
            <div className="owner-banner" role="status">
              <Icon icon={faEye} />
              <span className="min-w-0 flex-1">
                {t("You are viewing the space of {name}", {
                  name: ownerMember?.name || ownerMember?.email || "…",
                })}
              </span>
              <button
                className="secondary-button"
                onClick={() => navigate({ folder: "all", owner: null, scope: "all" })}
              >
                {t("Back to my drive")}
              </button>
            </div>
          ) : (
            <div className="scope-filter" role="group" aria-label={t("Show")}>
              {(
                [
                  ["all", "All"],
                  ["mine", "Mine"],
                  ["shared", "Shared with me"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={scope === value}
                  onClick={() => navigate({ scope: value })}
                >
                  {value === "shared" && <Icon icon={faUsers} />}
                  {t(label)}
                </button>
              ))}
            </div>
          )}

          {/* Folder chips on small screens (the panel is hidden there) */}
          <div className="folder-strip -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
            {BUILTIN_FOLDERS.map((tab) => (
              <button
                key={tab.slug}
                onClick={() => setActiveFolder(tab.slug)}
                className={`chip h-10 ${activeFolder === tab.slug ? "active" : ""}`}
              >
                {activeFolder === tab.slug && <Icon icon={faCheck} className="text-[11px]" />}
                {t(tab.label)}
                <span className="text-xs opacity-75">{folderCounts[tab.slug] ?? 0}</span>
              </button>
            ))}
            {customFolders.map((cf) => (
              <button
                key={cf.slug}
                onClick={() => setActiveFolder(cf.slug)}
                className={`chip h-10 ${activeFolder === cf.slug ? "active" : ""}`}
              >
                <Icon icon={cf.allowedUsers.length > 0 ? faLock : faFolder} className="text-[11px]" />
                {cf.name}
              </button>
            ))}
            <button
              onClick={() => {
                setFolderCreateOpen(true);
                setFolderCreateError(null);
              }}
              className="chip h-10 border-dashed"
            >
              <Icon icon={faFolderPlus} />
              {t("New folder")}
            </button>
          </div>
          {(() => {
            const currentCf = customFolders.find((cf) => cf.slug === activeFolder);
            return currentCf ? (
              <div className="flex flex-wrap gap-2 lg:hidden">
                <button onClick={() => setFolderAccess(currentCf)} className="secondary-button min-h-10 px-4">
                  <Icon icon={faUsers} /> {t("Manage folder access")}
                </button>
                <button onClick={() => setFolderDeleteTarget(currentCf)} className="danger-button min-h-10 px-4">
                  <Icon icon={faTrash} /> {t("Delete folder")}
                </button>
              </div>
            ) : null;
          })()}
          <button
            className="drive-fab"
            onClick={() => setUploadOpen(true)}
            aria-label={t("Upload")}
          >
            <Icon icon={faPlus} />
          </button>

      {loadError && (
        <p role="alert" className="text-sm text-rose-400">
          {t("Unable to load files. Try again or sign in again.")}
        </p>
      )}
      {/* File grid / list / details */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-ink-faint">
          <Icon icon={faRotateRight} className="animate-spin text-2xl" />
        </div>
      ) : viewMode === "details" ? (
        /* ── Details mode (master-detail) ────────────────────────────── */
        <div className="flex min-w-0 flex-col gap-4 lg:min-h-[400px] lg:flex-row">
          {/* Left: compact file list */}
          <div className="max-h-56 w-full shrink-0 overflow-y-auto rounded-card lg:max-h-[70dvh] lg:w-72 bg-surface-2">
            {/* Folder items when in "all" view */}
            {activeFolder === "all" &&
              customFolders.map((cf) => (
                <button
                  key={cf.slug}
                  onClick={() => setActiveFolder(cf.slug)}
                  className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2.5 hover:bg-white/5 transition-colors"
                >
                  <Icon
                    icon={faFolderOpen}
                    className="shrink-0 text-orange-400/70"
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-xs font-medium text-ink">
                      {cf.name}
                    </p>
                    <p className="text-[10px] text-ink-faint">
                      {folderCounts[cf.slug] ?? 0} {t("files")}
                    </p>
                  </div>
                </button>
              ))}
            {files.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-ink-faint">
                {activeFolder === "all" && customFolders.length === 0
                  ? t("No files")
                  : t("Empty folder")}
              </p>
            )}
            {sortedFiles.map((file) => (
              <button
                key={file._id}
                onClick={() => setDetailFile(file)}
                className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-2.5 transition-colors ${
                  detailFile?._id === file._id
                    ? "bg-orange-500/10"
                    : "hover:bg-white/5"
                }`}
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-black/20">
                  <FileThumbnail file={file} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-xs font-medium text-ink">
                    {file.name}
                  </p>
                  <p className="text-[10px] text-ink-faint">
                    {formatBytes(file.size)}
                  </p>
                </div>
              </button>
            ))}
          </div>
          {/* Right: details pane */}
          <div className="min-w-0 flex-1">
            {detailFile ? (
              <DetailsPane
                file={detailFile}
                onPreview={() => setPreviewFile(detailFile)}
                onShare={() => setShareFile(detailFile)}
                onMove={() => openMove(detailFile)}
                onRename={() => {
                  setRenameFile(detailFile);
                  setRenameName(detailFile.name);
                }}
                onDelete={() => setDeleteFile(detailFile)}
                onAccess={() => openAccessModal(detailFile)}
                onEdit={
                  isEditableTextFile(detailFile.name, detailFile.mimeType)
                    ? () => openTextEditor(detailFile)
                    : undefined
                }
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-card bg-surface-2 text-ink-faint">
                <Icon icon={faCircleInfo} className="text-4xl" />
                <p className="text-sm">
                  {t("Select a file to view its details")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : files.length === 0 &&
        !(activeFolder === "all" && customFolders.length > 0) ? (
        <div className="flex flex-col items-center justify-center py-24 text-ink-faint">
          <Icon icon={faHardDrive} className="mb-3 text-5xl" />
          <p className="text-sm">{t("No files found")}</p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Grid view ───────────────────────────────────────────────── */
        <div className="space-y-4 overflow-y-auto">
          {/* Folder cards (only in "all" view) */}
          {activeFolder === "all" && customFolders.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold">{t("Folders")}</h2>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {customFolders.map((cf) => (
                  <FolderCard
                    key={cf.slug}
                    folder={cf}
                    count={folderCounts[cf.slug] ?? 0}
                    onClick={() => setActiveFolder(cf.slug)}
                    onDragOver={(e) => handleFolderDragOver(e, cf.slug)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleFolderDrop(e, cf.slug, cf.name)}
                    dragOver={dragOverFolder === cf.slug && !!draggingFile}
                  />
                ))}
              </div>
            </div>
          )}
          {sortedFiles.length > 0 && (
            <div>
            <h2 className="mb-3 text-sm font-semibold">{t("Files")}</h2>
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {sortedFiles.map((file) => (
                <GridCard
                  key={file._id}
                  file={file}
                  onMove={() => openMove(file)}
                  onRename={() => {
                    setRenameFile(file);
                    setRenameName(file.name);
                  }}
                  onDelete={() => setDeleteFile(file)}
                  onCopy={() => handleCopy(file)}
                  onShare={() => setShareFile(file)}
                  onPreview={() => setPreviewFile(file)}
                  onAccess={() => openAccessModal(file)}
                  onEdit={
                    isEditableTextFile(file.name, file.mimeType)
                      ? () => openTextEditor(file)
                      : undefined
                  }
                  onDragStart={() => handleFileDragStart(file)}
                  onDragEnd={handleFileDragEnd}
                />
              ))}
            </div>
            </div>
          )}
        </div>
      ) : (
        /* ── List view ───────────────────────────────────────────────── */
        <div className="space-y-3 overflow-y-auto">
          {/* Folder rows (only in "all" view) */}
          {activeFolder === "all" && customFolders.length > 0 && (
            <div>
              <table className="drive-table w-full text-sm">
                <tbody>
                  {customFolders.map((cf) => (
                    <tr
                      key={cf.slug}
                      onClick={() => setActiveFolder(cf.slug)}
                      className="cursor-pointer transition-colors hover:bg-surface-2"
                    >
                      <td className="h-[52px] px-3" colSpan={5}>
                        <div className="flex items-center gap-3">
                          <Icon
                            icon={cf.allowedUsers.length > 0 ? faLock : faFolder}
                            className="w-6 text-[15px] text-ink-dim"
                          />
                          <span className="font-medium text-ink">
                            {cf.name}
                          </span>
                          {cf.description && (
                            <span className="text-xs text-ink-faint">
                              — {cf.description}
                            </span>
                          )}
                          {cf.allowedUsers.length > 0 && (
                            <Icon
                              icon={faLock}
                              className="text-[10px] text-ink-faint"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 text-right">
                        <span className="text-xs text-ink-faint">
                          {folderCounts[cf.slug] ?? 0} {t("files")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sortedFiles.length > 0 && (
            <div className="overflow-auto">
              <table className="drive-table w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-3">{t("Name")}</th>
                    <th className="px-3">{t("Folder")}</th>
                    <th className="px-3">{t("Uploaded by")}</th>
                    <th className="px-3">{t("Date")}</th>
                    <th className="px-3">{t("Size")}</th>
                    <th className="px-3 text-right">
                      <span className="sr-only">{t("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFiles.map((file) => (
                    <ListRow
                      key={file._id}
                      file={file}
                      onMove={() => openMove(file)}
                      onRename={() => {
                        setRenameFile(file);
                        setRenameName(file.name);
                      }}
                      onDelete={() => setDeleteFile(file)}
                      onCopy={() => handleCopy(file)}
                      onShare={() => setShareFile(file)}
                      onPreview={() => setPreviewFile(file)}
                      onAccess={() => openAccessModal(file)}
                      onEdit={
                        isEditableTextFile(file.name, file.mimeType)
                          ? () => openTextEditor(file)
                          : undefined
                      }
                      onDragStart={() => handleFileDragStart(file)}
                      onDragEnd={handleFileDragEnd}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

        </section>
      </div>

      {/* ── Upload Modal ─────────────────────────────────────────────────── */}
      <AdminModal
        open={uploadOpen}
        onClose={() => {
          if (!uploading) {
            setUploadOpen(false);
            setUploadQueue([]);
            setUploadProgress({});
            setUploadExpiresIn("");
          }
        }}
        title={t("Upload files")}
        size="md"
      >
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-card border-2 border-dashed border-white/20 bg-white/5 p-8 text-center hover:border-orange-500/50 hover:bg-white/900/5 transition-colors"
          >
            <Icon icon={faUpload} className="mb-2 text-3xl text-ink-faint" />
            <p className="text-sm text-ink-dim">
              {t("Drop files here or")}{" "}
              <span className="text-orange-400">{t("select files")}</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files)
                  setUploadQueue((q) => [...q, ...Array.from(e.target.files!)]);
              }}
            />
          </div>

          {/* Queue */}
          {uploadQueue.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {uploadQueue.map((f, i) => {
                const state = uploadProgress[f.name];
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileTypeIcon
                        mimeType={f.type}
                        className="flex-shrink-0"
                      />
                      <span className="truncate text-xs text-ink">
                        {f.name}
                      </span>
                      <span className="flex-shrink-0 text-xs text-ink-faint">
                        {formatBytes(f.size)}
                      </span>
                    </div>
                    {state === "done" && (
                      <Icon
                        icon={faCheck}
                        className="text-emerald-400 text-xs"
                      />
                    )}
                    {state === "error" && (
                      <Icon icon={faXmark} className="text-rose-400 text-xs" />
                    )}
                    {!state && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadQueue((q) => q.filter((_, j) => j !== i));
                        }}
                        className="text-ink-faint hover:text-rose-400 transition-colors"
                      >
                        <Icon icon={faXmark} className="text-xs" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Options */}
          <div>
            <label className="mb-1 block text-xs text-ink-dim">
              <Icon icon={faClockRotateLeft} className="mr-1" />
              {t("Automatic expiry (seconds, optional)")}
            </label>
            <input
              type="number"
              value={uploadExpiresIn}
              onChange={(e) => setUploadExpiresIn(e.target.value)}
              placeholder={t("e.g. 86400 for 24 hours")}
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                if (!uploading) {
                  setUploadOpen(false);
                  setUploadQueue([]);
                  setUploadProgress({});
                  setUploadExpiresIn("");
                }
              }}
              className="rounded-lg px-4 py-2 text-sm text-ink-dim hover:text-white transition-colors"
            >
              {t("Cancel")}
            </button>
            <button
              onClick={handleUploadSubmit}
              disabled={!uploadQueue.length || uploading}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <Icon icon={faRotateRight} className="animate-spin" />
              ) : (
                <Icon icon={faUpload} />
              )}
              {uploading
                ? t("Loading…")
                : t("Upload {count}", {
                    count: uploadQueue.length ? `(${uploadQueue.length})` : "",
                  })}
            </button>
          </div>
        </div>
      </AdminModal>

      {/* ── Rename Modal ─────────────────────────────────────────────────── */}
      <AdminModal
        open={!!renameFile}
        onClose={() => setRenameFile(null)}
        title={t("Rename file")}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-dim">
              {t("New name")}
            </label>
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRenameFile(null)}
              className="rounded-lg px-4 py-2 text-sm text-ink-dim hover:text-white transition-colors"
            >
              {t("Cancel")}
            </button>
            <button
              onClick={handleRename}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover transition-colors"
            >
              {t("Save")}
            </button>
          </div>
        </div>
      </AdminModal>

      {/* ── Share Modal ──────────────────────────────────────────────────── */}
      <AdminModal
        open={!!shareFile}
        onClose={() => setShareFile(null)}
        title={t("Sharing links · {name}", { name: shareFile?.name ?? "" })}
        size="xl"
      >
        {shareFile && (
          <div className="space-y-5">
            {/* Direct link */}
            <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/70">
                {t("Direct link")}
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-black/30 px-3 py-2">
                <span className="flex-1 truncate font-mono text-xs text-ink-dim">
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  {shareFile.url}
                </span>
                <button
                  onClick={copyDirectLink}
                  className="flex-shrink-0 flex items-center gap-1.5 rounded px-2 py-1 text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors"
                  title={t("Copy direct link")}
                >
                  <Icon
                    icon={copiedDirect ? faCheck : faCopy}
                    className={copiedDirect ? "text-emerald-400" : ""}
                  />
                  {copiedDirect ? t("Copied!") : t("Copy")}
                </button>
              </div>
              <p className="text-[10px] text-ink-faint">
                {t("Authenticated URL — requires an authorized account (")}
                {shareFile.mimeType || "file"}
                {t("). Respects file permissions and expiry.")}
              </p>
            </div>

            {/* Create new token */}
            <div className="rounded-card border border-white/[0.04] bg-white/5 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {t("New link")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-ink-dim">
                    <Icon icon={faLock} className="mr-1" />
                    {t("Password (optional)")}
                  </label>
                  <input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder={t("no password")}
                    className="w-full rounded-lg border border-white/[0.04] bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-orange-500/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-dim">
                    <Icon icon={faCalendar} className="mr-1" />
                    {t("Expiry (optional)")}
                  </label>
                  <input
                    type="datetime-local"
                    value={shareExpiry}
                    onChange={(e) => setShareExpiry(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.04] bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-orange-500/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-dim">
                    <Icon icon={faHashtag} className="mr-1" />
                    {t("Maximum downloads (optional)")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={shareMaxDownloads}
                    onChange={(e) => setShareMaxDownloads(e.target.value)}
                    placeholder="illimitati"
                    className="w-full rounded-lg border border-white/[0.04] bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-orange-500/30"
                  />
                </div>
              </div>
              <button
                onClick={handleCreateShare}
                disabled={shareCreating}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                <Icon icon={faLink} />
                {shareCreating ? t("Creating…") : t("Create link")}
              </button>
            </div>

            {/* Token list */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {t("Active links (")}
                {shareTokens.length})
              </p>
              {shareTokens.length === 0 ? (
                <p className="text-xs text-ink-faint">{t("No links created")}</p>
              ) : (
                shareTokens.map((shareToken) => (
                  <div
                    key={shareToken._id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-mono text-xs text-ink-dim">
                        {window?.location?.origin}/api/download/
                        {shareToken.token}
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-ink-faint">
                        {shareToken.expiresAt && (
                          <span>
                            <Icon icon={faCalendar} className="mr-0.5" />
                            {new Date(shareToken.expiresAt).toLocaleString(
                              dateLocale,
                            )}
                          </span>
                        )}
                        {shareToken.maxDownloads !== null ? (
                          <span>
                            <Icon icon={faDownload} className="mr-0.5" />
                            {shareToken.downloadCount}/{shareToken.maxDownloads}
                          </span>
                        ) : (
                          <span>
                            <Icon icon={faDownload} className="mr-0.5" />
                            {shareToken.downloadCount} download
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(shareToken.token)}
                      className="flex-shrink-0 rounded px-2 py-1 text-xs text-ink-dim hover:text-white transition-colors"
                      title={t("Copy link")}
                    >
                      <Icon
                        icon={
                          copiedToken === shareToken.token ? faCheck : faCopy
                        }
                        className={
                          copiedToken === shareToken.token
                            ? "text-emerald-400"
                            : ""
                        }
                      />
                    </button>
                    <button
                      onClick={() => handleRevokeToken(shareToken.token)}
                      className="flex-shrink-0 rounded px-2 py-1 text-xs text-rose-400/60 hover:text-rose-400 transition-colors"
                      title={t("Revoke")}
                    >
                      <Icon icon={faTrash} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Preview Modal ─────────────────────────────────────────────── */}
      <AdminModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        title={previewFile?.name ?? ""}
        size="xl"
      >
        {previewFile && (
          <div className="flex flex-col items-center gap-4">
            {previewFile.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewFile.url}
                alt={previewFile.name}
                className="max-h-[70vh] max-w-full rounded-lg object-contain"
              />
            ) : previewFile.mimeType.startsWith("video/") ? (
              <video
                src={previewFile.url}
                controls
                className="max-h-[70vh] max-w-full rounded-lg"
              />
            ) : previewFile.mimeType.startsWith("audio/") ? (
              <audio src={previewFile.url} controls className="w-full" />
            ) : isEditableTextFile(previewFile.name, previewFile.mimeType) ? (
              previewText === null ? (
                <div className="flex h-64 items-center justify-center gap-3 text-ink-faint">
                  <Icon icon={faRotateRight} className="animate-spin" />
                  <span className="text-sm">{t("Loading file…")}</span>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-3">
                  <TextPreview
                    filename={previewFile.name}
                    content={previewText}
                  />
                  <div className="flex justify-end">
                    <button
                      className="primary-button"
                      onClick={() => {
                        const file = previewFile;
                        setPreviewFile(null);
                        openTextEditor(file);
                      }}
                    >
                      <Icon icon={faPen} />
                      {t("Edit")}
                    </button>
                  </div>
                </div>
              )
            ) : previewFile.mimeType === "application/pdf" ? (
              <iframe
                src={previewFile.url}
                title={previewFile.name}
                className="h-[70vh] w-full rounded-lg border border-white/[0.04]"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-ink-faint">
                <Icon icon={faFile} className="text-5xl" />
                <p className="text-sm">
                  {t("Preview is not available for this file type")}
                </p>
                <a
                  href={previewFile.url}
                  download={previewFile.name}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-ink hover:bg-white/20 hover:text-white transition-colors"
                >
                  <Icon icon={faDownload} />
                  {t("Download file")}
                </a>
              </div>
            )}
          </div>
        )}
      </AdminModal>

      {/* ── Folder create modal ───────────────────────────────────────────── */}
      <AdminModal
        open={folderCreateOpen}
        onClose={() => {
          setFolderCreateOpen(false);
          setFolderCreateName("");
          setFolderCreateDesc("");
          setFolderCreateError(null);
        }}
        title={t("New folder")}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-dim">
              {t("Folder name *")}
            </label>
            <input
              value={folderCreateName}
              onChange={(e) => setFolderCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFolderCreate()}
              placeholder={t("e.g. Screenshots, FiveM assets…")}
              autoFocus
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
            {folderCreateName.trim() && (
              <p className="mt-1 text-[11px] text-ink-faint">
                Slug:{" "}
                <code className="text-ink-dim">
                  {folderCreateName
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 60)}
                </code>
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-dim">
              {t("Description (optional)")}
            </label>
            <input
              value={folderCreateDesc}
              onChange={(e) => setFolderCreateDesc(e.target.value)}
              placeholder={t("What is this folder for?")}
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
          </div>
          {folderCreateError && (
            <p className="text-xs text-rose-400">{t(folderCreateError)}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setFolderCreateOpen(false)}
              className="rounded-lg px-4 py-2 text-sm text-ink-dim hover:text-white transition-colors"
            >
              {t("Cancel")}
            </button>
            <button
              onClick={handleFolderCreate}
              disabled={folderCreateLoading || !folderCreateName.trim()}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {folderCreateLoading ? (
                <Icon icon={faRotateRight} className="animate-spin" />
              ) : (
                <Icon icon={faPlus} />
              )}
              {t("Create")}
            </button>
          </div>
        </div>
      </AdminModal>

      {/* ── File access modal ─────────────────────────────────────────────── */}
      <AdminModal
        open={!!accessFile}
        onClose={() => {
          setAccessFile(null);
          setAccessAddInput("");
          setAccessAddError(null);
        }}
        title={t("Access · {name}", { name: accessFile?.name ?? "" })}
        size="md"
      >
        {accessFile && (
          <div className="space-y-5">
            <div role="radiogroup" aria-label={t("Who can open this file")} className="space-y-2">
              {(
                [
                  ["private", faLock, "Private", "You, administrators and the people added below."],
                  ["members", faUsers, "All members", "Anyone authorized in the drive."],
                ] as const
              ).map(([value, icon, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(value === "members") === accessIsPublic}
                  className="visibility-option"
                  onClick={() => setFileVisibility(value)}
                >
                  <i aria-hidden="true">
                    <Icon icon={icon} />
                  </i>
                  <b>{t(label)}</b>
                  <span>{t(hint)}</span>
                </button>
              ))}
            </div>

            {/* Add user */}
            <div>
              <label htmlFor="access-add" className="mb-1 block text-xs text-ink-dim">
                {t("Add user (authorized email)")}
              </label>
              <div className="flex gap-2">
                <input
                  id="access-add"
                  value={accessAddInput}
                  onChange={(e) => setAccessAddInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAccessAdd()}
                  placeholder="nome@esempio.it"
                  className="flex-1 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
                />
                <button
                  onClick={handleAccessAdd}
                  aria-label={t("Add")}
                  disabled={accessAddLoading || !accessAddInput.trim()}
                  className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {accessAddLoading ? (
                    <Icon icon={faRotateRight} className="animate-spin" />
                  ) : (
                    <Icon icon={faPlus} />
                  )}
                </button>
              </div>
              {accessAddError && (
                <p className="mt-1 text-xs text-rose-400">
                  {t(accessAddError)}
                </p>
              )}
            </div>

            {/* User list */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {t("Authorized users (")}
                {accessUsers.length})
              </p>
              {accessUsers.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  {t("Nobody added yet.")}
                </p>
              ) : (
                accessUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {u.username}
                      </p>
                      <p className="text-xs text-ink-faint">{u.email}</p>
                    </div>
                    <button
                      onClick={() => handleAccessRevoke(u.id)}
                      className="rounded p-1.5 text-rose-400/50 hover:bg-rose-500/[0.06] hover:text-rose-400 transition-colors"
                      title={t("Revoke access")}
                    >
                      <Icon icon={faUserMinus} className="text-xs" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Folder delete confirm ─────────────────────────────────────────── */}
      <AdminModal
        open={!!folderDeleteTarget}
        onClose={() => {
          setFolderDeleteTarget(null);
          setFolderDeleteError(null);
        }}
        title={t('Delete folder "{name}"', {
          name: folderDeleteTarget?.name ?? "",
        })}
        size="md"
      >
        {folderDeleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-ink-dim">
              {t(
                "This folder will be deleted. Move or delete its files first.",
              )}
            </p>
            {folderDeleteError && (
              <p className="text-sm text-rose-400">{t(folderDeleteError)}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setFolderDeleteTarget(null);
                  setFolderDeleteError(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-ink-dim hover:text-white transition-colors"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleFolderDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-accent-on hover:bg-red-400 transition-colors"
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteFile}
        title={t("Delete file")}
        description={t(
          'Delete "{name}" permanently? All its sharing links will be invalidated.',
          { name: deleteFile?.name ?? "" },
        )}
        confirmLabel={t("Delete")}
        onConfirm={handleDelete}
        onCancel={() => setDeleteFile(null)}
        dangerous
      />

      {/* ── Move confirm dialog ───────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!moveConfirm}
        title={t("Move file")}
        description={t('Move "{name}" to "{folder}"?', {
          name: moveConfirm?.file.name ?? "",
          folder: moveConfirm?.targetName ?? "",
        })}
        confirmLabel={t("Move")}
        onConfirm={handleMoveFile}
        onCancel={() => {
          setMoveConfirm(null);
          setDraggingFile(null);
          setDragOverFolder(null);
        }}
      />

      {/* ── Text editor modal ─────────────────────────────────────────────── */}
      <AdminModal
        open={!!editTextFile}
        onClose={() => {
          if (!textContentSaving) setEditTextFile(null);
        }}
        title={t("Edit · {name}", { name: editTextFile?.name ?? "" })}
        size="xl"
        variant={editorFull ? "full" : editorLayout}
        actions={
          <button
            onClick={() => setEditorFull((full) => !full)}
            aria-label={t(editorFull ? "Exit full screen" : "Full screen")}
            title={t(editorFull ? "Exit full screen" : "Full screen")}
            aria-pressed={editorFull}
            className="icon-button h-11 w-11 max-sm:hidden"
          >
            <Icon icon={editorFull ? faDownLeftAndUpRightToCenter : faUpRightAndDownLeftFromCenter} />
          </button>
        }
      >
        {editTextFile && (
          <CdnTextEditor
            fileId={editTextFile._id}
            filename={editTextFile.name}
            mimeType={editTextFile.mimeType}
            content={textContent}
            loading={textContentLoading}
            saving={textContentSaving}
            readOnly={textReadOnly}
            notice={textNotice}
            onChange={setTextContent}
            onSave={handleSaveTextContent}
            onClose={() => setEditTextFile(null)}
          />
        )}
      </AdminModal>
    </div>
  );
}

/* ─── File context menu ──────────────────────────────────────────────────── */
function fileMenuProps(
  file: CdnFileItem,
  actions: {
    onPreview: () => void;
    onEdit?: () => void;
    onShare: () => void;
    onAccess: () => void;
    onRename: () => void;
    onMove: () => void;
    onCopy: () => void;
    onDelete: () => void;
  },
): { quick: FileMenuItem[]; items: FileMenuItem[] } {
  const download = () => {
    const link = document.createElement("a");
    link.href = `${file.url}?download=1`;
    link.download = file.name;
    link.click();
  };
  return {
    quick: [
      { label: "Open", icon: faEye, action: actions.onPreview },
      { label: "Edit", icon: faPenToSquare, action: actions.onEdit },
      { label: "Share", icon: faLink, action: actions.onShare },
      { label: "Download", icon: faDownload, action: download },
    ],
    items: [
      { label: "Manage access", icon: faUsers, action: actions.onAccess },
      { label: "Rename", icon: faPen, action: actions.onRename },
      { label: "Move", icon: faArrowsAlt, action: actions.onMove },
      { label: "Duplicate", icon: faCopy, action: actions.onCopy },
      { label: "Delete", icon: faTrash, action: actions.onDelete, danger: true, separated: true },
    ],
  };
}

/* ─── Grid card ───────────────────────────────────────────────────────────── */
function GridCard({
  file,
  onMove,
  onRename,
  onDelete,
  onCopy,
  onShare,
  onPreview,
  onAccess,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  file: CdnFileItem;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onShare: () => void;
  onPreview: () => void;
  onAccess: () => void;
  onEdit?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t, dateLocale } = useI18n();

  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const expiring = file.expiresAt && new Date(file.expiresAt) > new Date();
  return (
    <>
      <div
        className="file-card group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDoubleClick={onPreview}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex h-12 min-w-0 items-center gap-3 pl-2">
          <FileTypeIcon mimeType={file.mimeType} className="shrink-0 text-[15px]" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <button
            onClick={(e) => setMenu(anchorFromElement(e.currentTarget))}
            className="icon-button -mr-1 h-10 w-10"
            aria-label={t("File actions")}
            title={t("File actions")}
            aria-haspopup="menu"
            aria-expanded={!!menu}
          >
            <Icon icon={faEllipsisVertical} />
          </button>
        </div>
        <div className="relative aspect-[16/11] overflow-hidden rounded-lg bg-sheet">
          <button
            className="h-full w-full"
            onClick={onPreview}
            aria-label={t("Preview")}
          >
            <FileThumbnail file={file} />
          </button>
          {expiring && (
            <span className="status-badge absolute bottom-2 left-2 bg-yellow-500/15 text-yellow-500 backdrop-blur-sm">
              {t("Expires")}
            </span>
          )}
          <div className="file-actions-overlay absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {[
              { label: "Share", icon: faLink, action: onShare },
              { label: "Preview", icon: faEye, action: onPreview },
            ].map((item) => (
              <button
                key={item.label}
                onClick={(e) => {
                  e.stopPropagation();
                  item.action();
                }}
                className="grid h-9 w-9 place-items-center rounded-full bg-sheet text-[13px] text-ink shadow-lift"
                title={t(item.label)}
                aria-label={t(item.label)}
              >
                <Icon icon={item.icon} />
              </button>
            ))}
          </div>
        </div>
        <p className="flex min-w-0 items-center gap-2 px-1.5 pt-2.5 text-xs text-ink-dim">
          <span className="avatar h-[22px] w-[22px] bg-surface text-[9px] text-ink-dim">
            {file.uploadedByUsername.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate">
            {formatBytes(file.size)} ·{" "}
            {new Date(file.createdAt).toLocaleDateString(dateLocale, {
              day: "numeric",
              month: "short",
            })}
          </span>
        </p>
      </div>
      {menu && (
        <FileMenu
          anchor={menu}
          label={file.name}
          onClose={() => setMenu(null)}
          {...fileMenuProps(file, { onPreview, onEdit, onShare, onAccess, onRename, onMove, onCopy, onDelete })}
        />
      )}
    </>
  );
}

/* ─── Folder card ────────────────────────────────────────────────────────── */
function FolderCard({
  folder,
  count,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
}: {
  folder: CdnFolderItem;
  count: number;
  onClick: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dragOver?: boolean;
}) {
  const { t, dateLocale } = useI18n();

  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`folder-card ${dragOver ? "drop" : ""}`}
    >
      <Icon
        icon={folder.allowedUsers.length > 0 ? faLock : faFolder}
        className="shrink-0 text-[17px] text-ink-dim"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={folder.name}>
        {folder.name}
      </span>
      <span className="text-xs text-ink-faint">
        {count} {t(count === 1 ? "file" : "files")}
      </span>
    </button>
  );
}

/* ─── Details pane ────────────────────────────────────────────────────────── */
function DetailsPane({
  file,
  onPreview,
  onShare,
  onMove,
  onRename,
  onDelete,
  onAccess,
  onEdit,
}: {
  file: CdnFileItem;
  onPreview: () => void;
  onShare: () => void;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAccess: () => void;
  onEdit?: () => void;
}) {
  const { t, dateLocale } = useI18n();

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(file.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-card bg-surface-2 p-5">
      {/* Thumbnail */}
      <div className="h-52 w-full shrink-0 overflow-hidden rounded-lg bg-black/20">
        <FileThumbnail file={file} />
      </div>
      {/* Metadata grid */}
      <div className="space-y-2.5">
        <h3 className="break-all text-sm font-semibold text-white">
          {file.name}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div>
            <p className="mb-0.5 text-ink-faint">{t("MIME type")}</p>
            <p className="truncate font-mono text-ink">{file.mimeType}</p>
          </div>
          <div>
            <p className="mb-0.5 text-ink-faint">{t("Size")}</p>
            <p className="text-ink">{formatBytes(file.size)}</p>
          </div>
          <div>
            <p className="mb-0.5 text-ink-faint">{t("Folder")}</p>
            <p className="capitalize text-ink">{file.folder}</p>
          </div>
          <div>
            <p className="mb-0.5 text-ink-faint">{t("Uploaded by")}</p>
            <p className="text-ink">{file.uploadedByUsername}</p>
          </div>
          <div>
            <p className="mb-0.5 text-ink-faint">{t("Upload date")}</p>
            <p className="text-ink">
              {new Date(file.createdAt).toLocaleString(dateLocale)}
            </p>
          </div>
          {file.expiresAt && (
            <div>
              <p className="mb-0.5 text-ink-faint">{t("Expires")}</p>
              <p
                className={`font-medium ${
                  new Date(file.expiresAt) < new Date()
                    ? "text-rose-400"
                    : "text-yellow-400"
                }`}
              >
                {new Date(file.expiresAt).toLocaleString(dateLocale)}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-xs text-ink-faint">{t("File ID")}</p>
        <code className="break-all text-xs text-ink-dim">{file._id}</code>
      </div>
      {/* URL */}
      <div>
        <p className="mb-1.5 text-xs text-ink-faint">{t("Authenticated URL")}</p>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2">
          <span
            className="flex-1 truncate font-mono text-[11px] text-ink-faint"
            title={file.url}
          >
            {file.url}
          </span>
          <button
            onClick={copy}
            className="flex-shrink-0 text-xs text-ink-faint transition-colors hover:text-white"
            title={t("Copy URL")}
          >
            <Icon
              icon={copied ? faCheck : faCopy}
              className={copied ? "text-emerald-400" : ""}
            />
          </button>
        </div>
      </div>
      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onPreview}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-ink-dim transition-colors hover:text-white"
        >
          <Icon icon={faEye} /> {t("Preview")}
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400/60 transition-colors hover:text-blue-400"
          >
            <Icon icon={faFileCode} /> {t("Edit")}
          </button>
        )}
        <button
          onClick={onAccess}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-ink-dim transition-colors hover:text-white"
        >
          <Icon icon={faUsers} /> {t("Access")}
        </button>
        <button
          onClick={onShare}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-ink-dim transition-colors hover:text-white"
        >
          <Icon icon={faLink} /> {t("Share")}
        </button>
        <button onClick={onMove} className="secondary-button">
          {t("Move")}
        </button>
        <button
          onClick={onRename}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-ink-dim transition-colors hover:text-white"
        >
          <Icon icon={faPen} /> {t("Rename")}
        </button>
        <a
          href={file.url}
          download={file.name}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-ink-dim transition-colors hover:text-white"
        >
          <Icon icon={faDownload} /> Download
        </a>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg border border-rose-500/15 bg-red-500/5 px-3 py-2 text-xs text-rose-400/60 transition-colors hover:text-rose-400"
        >
          <Icon icon={faTrash} /> {t("Delete")}
        </button>
      </div>
    </div>
  );
}

/* ─── List row ────────────────────────────────────────────────────────────── */
function ListRow({
  file,
  onMove,
  onRename,
  onDelete,
  onCopy,
  onShare,
  onPreview,
  onAccess,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  file: CdnFileItem;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onShare: () => void;
  onPreview: () => void;
  onAccess: () => void;
  onEdit?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t, dateLocale } = useI18n();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  return (
    <tr
      className="group cursor-grab transition-colors hover:bg-surface-2 active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={onPreview}
    >
      <td className="h-[52px] px-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center overflow-hidden rounded-md">
            <FileThumbnail file={file} small />
          </div>
          <span className="min-w-0 max-w-md truncate font-medium" title={file.name}>
            {file.name}
          </span>
          {file.expiresAt && new Date(file.expiresAt) > new Date() && (
            <span className="status-badge shrink-0 bg-yellow-500/15 text-yellow-500">
              {t("Expires")}
            </span>
          )}
        </div>
      </td>
      <td className="col-meta px-3">
        <span className="text-[13px] capitalize text-ink-dim">{file.folder}</span>
      </td>
      <td className="col-meta px-3 text-[13px] text-ink-dim">
        {file.uploadedByUsername}
      </td>
      <td className="col-meta whitespace-nowrap px-3 text-[13px] text-ink-dim">
        {new Date(file.createdAt).toLocaleDateString(dateLocale)}
      </td>
      <td className="col-meta whitespace-nowrap px-3 text-[13px] text-ink-dim">
        {formatBytes(file.size)}
      </td>
      <td className="px-2">
        <div className="flex items-center justify-end">
        <div className="hidden items-center justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:flex">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onMove();
            }}
            title={t("Move")}
            aria-label={t("Move")}
            className="icon-button h-9 w-9 text-[13px]"
          >
            <Icon icon={faFolderOpen} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="icon-button h-9 w-9 text-[13px]"
            title={t("Preview")}
            aria-label={t("Preview")}
          >
            <Icon icon={faEye} />
          </button>
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="icon-button h-9 w-9 text-[13px] text-blue-500"
              title={t("Edit text")}
            >
              <Icon icon={faFileCode} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccess();
            }}
            className="icon-button h-9 w-9 text-[13px]"
            title={t("Manage access")}
          >
            <Icon icon={faUsers} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="icon-button h-9 w-9 text-[13px]"
            title={t("Share")}
          >
            <Icon icon={faLink} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="icon-button h-9 w-9 text-[13px]"
            title={t("Rename")}
          >
            <Icon icon={faPen} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="icon-button h-9 w-9 text-[13px]"
            title={t("Duplicate")}
          >
            <Icon icon={faCopy} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="icon-button h-9 w-9 text-[13px] hover:text-rose-500"
            title={t("Delete")}
          >
            <Icon icon={faTrash} />
          </button>
        </div>
        <button
          onClick={(e) => setMenu(anchorFromElement(e.currentTarget))}
          className="icon-button h-10 w-10"
          aria-label={t("File actions")}
          title={t("File actions")}
          aria-haspopup="menu"
          aria-expanded={!!menu}
        >
          <Icon icon={faEllipsisVertical} />
        </button>
        </div>
        {menu && (
          <FileMenu
            anchor={menu}
            label={file.name}
            onClose={() => setMenu(null)}
            {...fileMenuProps(file, { onPreview, onEdit, onShare, onAccess, onRename, onMove, onCopy, onDelete })}
          />
        )}
      </td>
    </tr>
  );
}
