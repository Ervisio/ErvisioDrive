"use client";

import { useState, useRef, useCallback, useMemo } from "react";
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
} from "@fortawesome/free-solid-svg-icons";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { AdminModal } from "@/components/admin/AdminModal";
import { formatBytes } from "@/lib/format";
import {
  CdnTextEditor,
  isEditableTextFile,
} from "@/components/admin/cdn/CdnTextEditor";

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
  { value: "size-desc", label: "Peso (↓)" },
  { value: "size-asc", label: "Peso (↑)" },
  { value: "date-desc", label: "Recente (↓)" },
  { value: "date-asc", label: "Recente (↑)" },
];

const BUILTIN_FOLDERS = [
  { slug: "all", label: "Tutti", icon: faFolder },
  { slug: "images", label: "Immagini", icon: faImage },
  { slug: "videos", label: "Video", icon: faFilm },
  { slug: "audio", label: "Audio", icon: faMusic },
  { slug: "documents", label: "Documenti", icon: faFile },
  { slug: "other", label: "Altri", icon: faFile },
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
  if (mimeType.startsWith("image/"))
    return <Icon icon={faImage} className={`text-blue-400 ${className}`} />;
  if (mimeType.startsWith("video/"))
    return <Icon icon={faFilm} className={`text-purple-400 ${className}`} />;
  if (mimeType.startsWith("audio/"))
    return <Icon icon={faMusic} className={`text-emerald-400 ${className}`} />;
  return <Icon icon={faFile} className={`text-orange-400 ${className}`} />;
}

/* ─── File thumbnail ──────────────────────────────────────────────────────── */
function FileThumbnail({ file }: { file: CdnFileItem }) {
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
      <FileTypeIcon mimeType={file.mimeType} className="text-3xl opacity-50" />
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */
export default function CdnPage() {
  const [folderAccess, setFolderAccess] = useState<CdnFolderItem | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
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

  const buildUrl = () => {
    let url = `/api/admin/cdn/files?`;
    if (activeFolder !== "all") url += `folder=${activeFolder}&`;
    if (search.trim()) url += `search=${encodeURIComponent(search.trim())}&`;
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
  const openTextEditor = async (file: CdnFileItem) => {
    setEditTextFile(file);
    setTextContentLoading(true);
    setTextContent("");
    try {
      const res = await request(`/api/admin/cdn/files/${file._id}/content`);
      const json = await res.json();
      if (json.success) setTextContent(json.content);
    } finally {
      setTextContentLoading(false);
    }
  };

  const handleSaveTextContent = async () => {
    if (!editTextFile) return;
    setTextContentSaving(true);
    try {
      await request(`/api/admin/cdn/files/${editTextFile._id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: textContent }),
      });
      mutate();
      setEditTextFile(null);
    } finally {
      setTextContentSaving(false);
    }
  };

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
    <div className="flex h-full flex-col gap-6 p-6">
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon icon={faHardDrive} className="text-2xl text-orange-400" />
          <div>
            <h1 className="text-xl font-bold">ErvisioDrive</h1>
            <p className="text-xs text-white/50">
              {folderCounts.all} {folderCounts.all === 1 ? "file" : "files"}{" "}
              totali
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Icon
              icon={faSearch}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca file..."
              className="h-9 rounded-lg border border-white/[0.04] bg-white/5 pl-8 pr-3 text-sm leading-none outline-none focus:border-orange-500/30 w-52"
            />
          </div>
          {/* Guida link */}
          <Link
            href="/docs"
            className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.04] bg-white/5 px-3 text-xs font-medium text-white/50 hover:text-white transition-colors"
          >
            <Icon icon={faBook} />
            Guida
          </Link>
          {/* Sort selector */}
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 pl-2.5 pr-1 h-9">
            <Icon icon={faSort} className="text-xs text-white/30 shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              className="bg-transparent text-xs text-white/70 outline-none cursor-pointer pr-1"
            >
              {SORT_OPTIONS.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  className="bg-[#16161f] text-white"
                >
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {/* View toggle */}
          <div className="flex overflow-hidden rounded-lg border border-white/[0.04]">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex h-9 w-9 items-center justify-center text-sm transition-colors ${
                viewMode === "grid"
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white"
              }`}
              title="Vista griglia"
            >
              <Icon icon={faTableCells} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex h-9 w-9 items-center justify-center text-sm transition-colors ${
                viewMode === "list"
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white"
              }`}
              title="Vista lista"
            >
              <Icon icon={faList} />
            </button>
            <button
              onClick={() => setViewMode("details")}
              className={`flex h-9 w-9 items-center justify-center text-sm transition-colors ${
                viewMode === "details"
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white"
              }`}
              title="Vista dettagli"
            >
              <Icon icon={faCircleInfo} />
            </button>
          </div>
          {/* Upload */}
          <button
            onClick={() => setUploadOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 transition-colors"
          >
            <Icon icon={faUpload} />
            Carica
          </button>
        </div>
      </div>

      {/* Folder tabs */}
      <div className="flex flex-wrap gap-1.5">
        {BUILTIN_FOLDERS.map((tab) => (
          <button
            key={tab.slug}
            onClick={() => setActiveFolder(tab.slug)}
            onDragOver={(e) => handleFolderDragOver(e, tab.slug)}
            onDragLeave={handleFolderDragLeave}
            onDrop={(e) => handleFolderDrop(e, tab.slug, tab.label)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
              ${
                activeFolder === tab.slug
                  ? "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
              }
              ${dragOverFolder === tab.slug && draggingFile ? "ring-2 ring-orange-400 bg-orange-500/20 text-orange-400" : ""}
            `}
          >
            <Icon icon={tab.icon} />
            {tab.label}
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] leading-none">
              {folderCounts[tab.slug] ?? 0}
            </span>
          </button>
        ))}

        {/* Custom folders */}
        {customFolders.map((cf) => (
          <div key={cf.slug} className="group relative flex items-center">
            <button
              onClick={() => setActiveFolder(cf.slug)}
              onDragOver={(e) => handleFolderDragOver(e, cf.slug)}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, cf.slug, cf.name)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
                ${
                  activeFolder === cf.slug
                    ? "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40"
                    : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
                }
                ${dragOverFolder === cf.slug && draggingFile ? "ring-2 ring-orange-400 bg-orange-500/20 text-orange-400" : ""}
              `}
            >
              <Icon icon={faFolderOpen} />
              {cf.name}
              {cf.allowedUsers.length > 0 && (
                <Icon icon={faLock} className="text-[9px] opacity-60" />
              )}
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] leading-none">
                {folderCounts[cf.slug] ?? 0}
              </span>
            </button>
            <button
              onClick={() => setFolderAccess(cf)}
              title="Gestisci accessi cartella"
              className="ml-1 p-1 text-xs text-white/30 hover:text-orange-400"
            >
              <Icon icon={faUsers} />
            </button>
            {/* Delete custom folder */}
            <button
              onClick={() => setFolderDeleteTarget(cf)}
              className="ml-0.5 hidden h-5 w-5 items-center justify-center rounded text-rose-400/50 hover:bg-rose-500/[0.06] hover:text-rose-400 group-hover:flex transition-colors"
              title="Elimina cartella"
            >
              <Icon icon={faXmark} className="text-[10px]" />
            </button>
          </div>
        ))}

        {/* Create folder button */}
        <button
          onClick={() => {
            setFolderCreateOpen(true);
            setFolderCreateError(null);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-1.5 text-xs font-medium text-white/30 hover:border-orange-500/40 hover:text-orange-400 transition-colors"
        >
          <Icon icon={faFolderPlus} />
          Nuova cartella
        </button>
      </div>

      {/* Breadcrumb — shown when inside a custom folder */}
      {(() => {
        const currentCf = customFolders.find((cf) => cf.slug === activeFolder);
        return currentCf ? (
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/5 px-4 py-2.5">
            <button
              onClick={() => setActiveFolder("all")}
              className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors"
            >
              <Icon icon={faArrowLeft} className="text-xs" />
              Torna indietro
            </button>
            <span className="text-white/20">/</span>
            <div className="flex items-center gap-2 text-sm">
              <Icon icon={faFolderOpen} className="text-orange-400" />
              <span className="font-medium text-white">{currentCf.name}</span>
              {currentCf.description && (
                <span className="text-xs text-white/30">
                  — {currentCf.description}
                </span>
              )}
            </div>
          </div>
        ) : null;
      })()}

      {loadError && (
        <p role="alert" className="text-sm text-rose-400">
          Impossibile caricare i file. Riprova o accedi di nuovo.
        </p>
      )}
      {/* File grid / list / details */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-white/30">
          <Icon icon={faRotateRight} className="animate-spin text-2xl" />
        </div>
      ) : viewMode === "details" ? (
        /* ── Details mode (master-detail) ────────────────────────────── */
        <div className="flex min-h-[400px] gap-4 overflow-hidden">
          {/* Left: compact file list */}
          <div className="w-72 shrink-0 overflow-y-auto rounded-xl border border-white/[0.04] bg-[#111118]">
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
                    <p className="truncate text-xs font-medium text-white/70">
                      {cf.name}
                    </p>
                    <p className="text-[10px] text-white/30">
                      {folderCounts[cf.slug] ?? 0} file
                    </p>
                  </div>
                </button>
              ))}
            {files.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-white/30">
                {activeFolder === "all" && customFolders.length === 0
                  ? "Nessun file"
                  : "Cartella vuota"}
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
                  <p className="truncate text-xs font-medium text-white/80">
                    {file.name}
                  </p>
                  <p className="text-[10px] text-white/30">
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
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.04] bg-[#111118] text-white/20">
                <Icon icon={faCircleInfo} className="text-4xl" />
                <p className="text-sm">
                  Seleziona un file per vedere i dettagli
                </p>
              </div>
            )}
          </div>
        </div>
      ) : files.length === 0 &&
        !(activeFolder === "all" && customFolders.length > 0) ? (
        <div className="flex flex-col items-center justify-center py-24 text-white/30">
          <Icon icon={faHardDrive} className="mb-3 text-5xl" />
          <p className="text-sm">Nessun file trovato</p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Grid view ───────────────────────────────────────────────── */
        <div className="space-y-4 overflow-y-auto">
          {/* Folder cards (only in "all" view) */}
          {activeFolder === "all" && customFolders.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/30">
                Cartelle
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {sortedFiles.map((file) => (
                <GridCard
                  key={file._id}
                  file={file}
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
          )}
        </div>
      ) : (
        /* ── List view ───────────────────────────────────────────────── */
        <div className="space-y-3 overflow-y-auto">
          {/* Folder rows (only in "all" view) */}
          {activeFolder === "all" && customFolders.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-white/[0.04]">
              <table className="w-full text-sm">
                <tbody>
                  {customFolders.map((cf) => (
                    <tr
                      key={cf.slug}
                      onClick={() => setActiveFolder(cf.slug)}
                      className="cursor-pointer border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3" colSpan={5}>
                        <div className="flex items-center gap-3">
                          <Icon
                            icon={faFolderOpen}
                            className="text-orange-400/70"
                          />
                          <span className="font-medium text-white/80">
                            {cf.name}
                          </span>
                          {cf.description && (
                            <span className="text-xs text-white/30">
                              — {cf.description}
                            </span>
                          )}
                          {cf.allowedUsers.length > 0 && (
                            <Icon
                              icon={faLock}
                              className="text-[10px] text-white/30"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-white/30">
                          {folderCounts[cf.slug] ?? 0} file
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sortedFiles.length > 0 && (
            <div className="overflow-auto rounded-xl border border-white/[0.04]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.04] text-left text-xs text-white/40">
                    <th className="px-4 py-3">File</th>
                    <th className="px-4 py-3">Cartella</th>
                    <th className="px-4 py-3">Dimensione</th>
                    <th className="px-4 py-3">Caricato da</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFiles.map((file) => (
                    <ListRow
                      key={file._id}
                      file={file}
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
        title="Carica file"
        size="md"
      >
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-white/20 bg-white/5 p-8 text-center hover:border-orange-500/50 hover:bg-orange-500/5 transition-colors"
          >
            <Icon icon={faUpload} className="mb-2 text-3xl text-white/30" />
            <p className="text-sm text-white/50">
              Trascina i file qui oppure{" "}
              <span className="text-orange-400">clicca per selezionare</span>
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
                      <span className="truncate text-xs text-white/70">
                        {f.name}
                      </span>
                      <span className="flex-shrink-0 text-xs text-white/30">
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
                        className="text-white/30 hover:text-rose-400 transition-colors"
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
            <label className="mb-1 block text-xs text-white/50">
              <Icon icon={faClockRotateLeft} className="mr-1" />
              Scadenza automatica (secondi, opzionale)
            </label>
            <input
              type="number"
              value={uploadExpiresIn}
              onChange={(e) => setUploadExpiresIn(e.target.value)}
              placeholder="es. 86400 per 24 ore"
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
              className="rounded-lg px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleUploadSubmit}
              disabled={!uploadQueue.length || uploading}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 transition-colors"
            >
              {uploading ? (
                <Icon icon={faRotateRight} className="animate-spin" />
              ) : (
                <Icon icon={faUpload} />
              )}
              {uploading
                ? "Caricamento..."
                : `Carica ${uploadQueue.length > 0 ? `(${uploadQueue.length})` : ""}`}
            </button>
          </div>
        </div>
      </AdminModal>

      {/* ── Rename Modal ─────────────────────────────────────────────────── */}
      <AdminModal
        open={!!renameFile}
        onClose={() => setRenameFile(null)}
        title="Rinomina file"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-white/50">
              Nuovo nome
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
              className="rounded-lg px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleRename}
              className="rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 transition-colors"
            >
              Salva
            </button>
          </div>
        </div>
      </AdminModal>

      {/* ── Share Modal ──────────────────────────────────────────────────── */}
      <AdminModal
        open={!!shareFile}
        onClose={() => setShareFile(null)}
        title={`Link condivisione — ${shareFile?.name ?? ""}`}
        size="xl"
      >
        {shareFile && (
          <div className="space-y-5">
            {/* Direct link */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/70">
                Link diretto
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-black/30 px-3 py-2">
                <span className="flex-1 truncate font-mono text-xs text-white/50">
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  {shareFile.url}
                </span>
                <button
                  onClick={copyDirectLink}
                  className="flex-shrink-0 flex items-center gap-1.5 rounded px-2 py-1 text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors"
                  title="Copia link diretto"
                >
                  <Icon
                    icon={copiedDirect ? faCheck : faCopy}
                    className={copiedDirect ? "text-emerald-400" : ""}
                  />
                  {copiedDirect ? "Copiato!" : "Copia"}
                </button>
              </div>
              <p className="text-[10px] text-white/30">
                URL autenticato — richiede un account autorizzato (
                {shareFile.mimeType || "file"}). Rispetta i permessi e la
                scadenza del file.
              </p>
            </div>

            {/* Create new token */}
            <div className="rounded-xl border border-white/[0.04] bg-white/5 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Nuovo link
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-white/50">
                    <Icon icon={faLock} className="mr-1" />
                    Password (opzionale)
                  </label>
                  <input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="nessuna password"
                    className="w-full rounded-lg border border-white/[0.04] bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-orange-500/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">
                    <Icon icon={faCalendar} className="mr-1" />
                    Scadenza (opzionale)
                  </label>
                  <input
                    type="datetime-local"
                    value={shareExpiry}
                    onChange={(e) => setShareExpiry(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.04] bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-orange-500/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">
                    <Icon icon={faHashtag} className="mr-1" />
                    Max download (opzionale)
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
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 transition-colors"
              >
                <Icon icon={faLink} />
                {shareCreating ? "Creazione..." : "Crea link"}
              </button>
            </div>

            {/* Token list */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Link attivi ({shareTokens.length})
              </p>
              {shareTokens.length === 0 ? (
                <p className="text-xs text-white/30">Nessun link creato</p>
              ) : (
                shareTokens.map((t) => (
                  <div
                    key={t._id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-mono text-xs text-white/60">
                        {window?.location?.origin}/api/download/{t.token}
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-white/30">
                        {t.expiresAt && (
                          <span>
                            <Icon icon={faCalendar} className="mr-0.5" />
                            {new Date(t.expiresAt).toLocaleString("it-IT")}
                          </span>
                        )}
                        {t.maxDownloads !== null ? (
                          <span>
                            <Icon icon={faDownload} className="mr-0.5" />
                            {t.downloadCount}/{t.maxDownloads}
                          </span>
                        ) : (
                          <span>
                            <Icon icon={faDownload} className="mr-0.5" />
                            {t.downloadCount} download
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(t.token)}
                      className="flex-shrink-0 rounded px-2 py-1 text-xs text-white/50 hover:text-white transition-colors"
                      title="Copia link"
                    >
                      <Icon
                        icon={copiedToken === t.token ? faCheck : faCopy}
                        className={
                          copiedToken === t.token ? "text-emerald-400" : ""
                        }
                      />
                    </button>
                    <button
                      onClick={() => handleRevokeToken(t.token)}
                      className="flex-shrink-0 rounded px-2 py-1 text-xs text-rose-400/60 hover:text-rose-400 transition-colors"
                      title="Revoca"
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
            ) : previewFile.mimeType === "application/pdf" ? (
              <iframe
                src={previewFile.url}
                title={previewFile.name}
                className="h-[70vh] w-full rounded-lg border border-white/[0.04]"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-white/30">
                <Icon icon={faFile} className="text-5xl" />
                <p className="text-sm">
                  Anteprima non disponibile per questo tipo di file
                </p>
                <a
                  href={previewFile.url}
                  download={previewFile.name}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                >
                  <Icon icon={faDownload} />
                  Scarica il file
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
        title="Nuova cartella"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-white/50">
              Nome cartella *
            </label>
            <input
              value={folderCreateName}
              onChange={(e) => setFolderCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFolderCreate()}
              placeholder="es. Screenshot, Assets FiveM..."
              autoFocus
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
            {folderCreateName.trim() && (
              <p className="mt-1 text-[11px] text-white/30">
                Slug:{" "}
                <code className="text-white/50">
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
            <label className="mb-1 block text-xs text-white/50">
              Descrizione (opzionale)
            </label>
            <input
              value={folderCreateDesc}
              onChange={(e) => setFolderCreateDesc(e.target.value)}
              placeholder="A cosa serve questa cartella?"
              className="w-full rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
            />
          </div>
          {folderCreateError && (
            <p className="text-xs text-rose-400">{folderCreateError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setFolderCreateOpen(false)}
              className="rounded-lg px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleFolderCreate}
              disabled={folderCreateLoading || !folderCreateName.trim()}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 transition-colors"
            >
              {folderCreateLoading ? (
                <Icon icon={faRotateRight} className="animate-spin" />
              ) : (
                <Icon icon={faPlus} />
              )}
              Crea
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
        title={`Accesso — ${accessFile?.name ?? ""}`}
        size="md"
      >
        {accessFile && (
          <div className="space-y-5">
            {/* Status */}
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                accessIsPublic
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-orange-500/10 text-orange-400"
              }`}
            >
              <Icon icon={accessIsPublic ? faUsers : faLock} />
              {accessIsPublic
                ? "Accessibile a tutti gli utenti autorizzati"
                : `File privato — solo ${accessUsers.length} ${accessUsers.length === 1 ? "utente autorizzato" : "utenti autorizzati"}`}
            </div>

            {/* Add user */}
            <div>
              <label className="mb-1 block text-xs text-white/50">
                Aggiungi utente (email autorizzata)
              </label>
              <div className="flex gap-2">
                <input
                  value={accessAddInput}
                  onChange={(e) => setAccessAddInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAccessAdd()}
                  placeholder="nome@esempio.it"
                  className="flex-1 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/30"
                />
                <button
                  onClick={handleAccessAdd}
                  disabled={accessAddLoading || !accessAddInput.trim()}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 transition-colors"
                >
                  {accessAddLoading ? (
                    <Icon icon={faRotateRight} className="animate-spin" />
                  ) : (
                    <Icon icon={faPlus} />
                  )}
                </button>
              </div>
              {accessAddError && (
                <p className="mt-1 text-xs text-rose-400">{accessAddError}</p>
              )}
            </div>

            {/* User list */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/30">
                Utenti autorizzati ({accessUsers.length})
              </p>
              {accessUsers.length === 0 ? (
                <p className="text-xs text-white/30">
                  Tutti gli utenti autorizzati
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
                      <p className="text-xs text-white/40">{u.email}</p>
                    </div>
                    <button
                      onClick={() => handleAccessRevoke(u.id)}
                      className="rounded p-1.5 text-rose-400/50 hover:bg-rose-500/[0.06] hover:text-rose-400 transition-colors"
                      title="Revoca accesso"
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
        title={`Elimina cartella "${folderDeleteTarget?.name ?? ""}"`}
        size="md"
      >
        {folderDeleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-white/60">
              La cartella verrà eliminata. I file al suo interno devono essere
              spostati o eliminati prima.
            </p>
            {folderDeleteError && (
              <p className="text-sm text-rose-400">{folderDeleteError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setFolderDeleteTarget(null);
                  setFolderDeleteError(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleFolderDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 transition-colors"
              >
                Elimina
              </button>
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteFile}
        title="Elimina file"
        description={`Sei sicuro di voler eliminare "${deleteFile?.name}"? L'azione è irreversibile e tutti i link di condivisione associati saranno invalidati.`}
        confirmLabel="Elimina"
        onConfirm={handleDelete}
        onCancel={() => setDeleteFile(null)}
        dangerous
      />

      {/* ── Move confirm dialog ───────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!moveConfirm}
        title="Sposta file"
        description={`Spostare "${moveConfirm?.file.name}" nella cartella "${moveConfirm?.targetName}"?`}
        confirmLabel="Sposta"
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
        title={`Modifica — ${editTextFile?.name ?? ""}`}
        size="xl"
      >
        {editTextFile && (
          <CdnTextEditor
            fileId={editTextFile._id}
            filename={editTextFile.name}
            mimeType={editTextFile.mimeType}
            content={textContent}
            loading={textContentLoading}
            saving={textContentSaving}
            onChange={setTextContent}
            onSave={handleSaveTextContent}
            onClose={() => setEditTextFile(null)}
          />
        )}
      </AdminModal>
    </div>
  );
}

/* ─── Grid card ───────────────────────────────────────────────────────────── */
function GridCard({
  file,
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
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.04] bg-white/5 hover:border-orange-500/20 transition-colors cursor-grab active:cursor-grabbing"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onPreview}
    >
      {/* Thumbnail */}
      <div className="relative h-32 bg-black/20">
        <FileThumbnail file={file} />
        {hover && (
          <div className="absolute inset-0 flex items-center justify-center flex-wrap gap-1.5 bg-black/60 backdrop-blur-sm p-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title="Anteprima"
            >
              <Icon icon={faEye} />
            </button>
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-blue-400/80 hover:bg-blue-500/20 hover:text-blue-300 transition-colors"
                title="Modifica testo"
              >
                <Icon icon={faFileCode} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccess();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title="Gestione accesso"
            >
              <Icon icon={faUsers} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShare();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title="Condividi"
            >
              <Icon icon={faLink} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title="Rinomina"
            >
              <Icon icon={faPen} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title="Duplica"
            >
              <Icon icon={faCopy} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs text-rose-400/70 hover:bg-rose-500/[0.06] hover:text-rose-400 transition-colors"
              title="Elimina"
            >
              <Icon icon={faTrash} />
            </button>
          </div>
        )}
        {/* Drag indicator */}
        <div className="absolute top-1 left-1 hidden group-hover:flex items-center justify-center h-5 w-5 rounded bg-black/40">
          <Icon icon={faArrowsAlt} className="text-[9px] text-white/40" />
        </div>
        {/* Expiry badge */}
        {file.expiresAt && new Date(file.expiresAt) > new Date() && (
          <span className="absolute bottom-1 right-1 rounded bg-yellow-500/80 px-1 py-0.5 text-[9px] font-bold text-black">
            EXP
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <p
          className="truncate text-xs font-medium text-white/80"
          title={file.name}
        >
          {file.name}
        </p>
        <p className="mt-0.5 text-[10px] text-white/30">
          {formatBytes(file.size)}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-white/20">
          <Icon icon={faUser} className="shrink-0" />
          <span className="truncate">{file.uploadedByUsername}</span>
        </p>
      </div>
    </div>
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
  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex flex-col items-center gap-3 rounded-xl border p-4 transition-colors ${
        dragOver
          ? "border-orange-400 bg-orange-500/15 ring-2 ring-orange-400"
          : "border-white/[0.04] bg-white/5 hover:border-orange-500/30 hover:bg-orange-500/5"
      }`}
    >
      <Icon
        icon={faFolderOpen}
        className={`text-4xl transition-colors ${dragOver ? "text-orange-400" : "text-orange-400/60 group-hover:text-orange-400"}`}
      />
      <div className="w-full text-center">
        <p
          className="truncate text-xs font-medium text-white/80"
          title={folder.name}
        >
          {folder.name}
        </p>
        <p className="mt-0.5 text-[10px] text-white/30">{count} file</p>
        {folder.allowedUsers.length > 0 && (
          <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-orange-400/50">
            <Icon icon={faLock} /> privata
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── Details pane ────────────────────────────────────────────────────────── */
function DetailsPane({
  file,
  onPreview,
  onShare,
  onRename,
  onDelete,
  onAccess,
  onEdit,
}: {
  file: CdnFileItem;
  onPreview: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAccess: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(file.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-xl border border-white/[0.04] bg-[#111118] p-5">
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
            <p className="mb-0.5 text-white/30">Tipo MIME</p>
            <p className="truncate font-mono text-white/70">{file.mimeType}</p>
          </div>
          <div>
            <p className="mb-0.5 text-white/30">Dimensione</p>
            <p className="text-white/70">{formatBytes(file.size)}</p>
          </div>
          <div>
            <p className="mb-0.5 text-white/30">Cartella</p>
            <p className="capitalize text-white/70">{file.folder}</p>
          </div>
          <div>
            <p className="mb-0.5 text-white/30">Caricato da</p>
            <p className="text-white/70">{file.uploadedByUsername}</p>
          </div>
          <div>
            <p className="mb-0.5 text-white/30">Data upload</p>
            <p className="text-white/70">
              {new Date(file.createdAt).toLocaleString("it-IT")}
            </p>
          </div>
          {file.expiresAt && (
            <div>
              <p className="mb-0.5 text-white/30">Scadenza</p>
              <p
                className={`font-medium ${
                  new Date(file.expiresAt) < new Date()
                    ? "text-rose-400"
                    : "text-yellow-400"
                }`}
              >
                {new Date(file.expiresAt).toLocaleString("it-IT")}
              </p>
            </div>
          )}
        </div>
      </div>
      {/* URL */}
      <div>
        <p className="mb-1.5 text-xs text-white/30">URL autenticato</p>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2">
          <span
            className="flex-1 truncate font-mono text-[11px] text-white/40"
            title={file.url}
          >
            {file.url}
          </span>
          <button
            onClick={copy}
            className="flex-shrink-0 text-xs text-white/40 transition-colors hover:text-white"
            title="Copia URL"
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
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <Icon icon={faEye} /> Anteprima
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400/60 transition-colors hover:text-blue-400"
          >
            <Icon icon={faFileCode} /> Modifica
          </button>
        )}
        <button
          onClick={onAccess}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <Icon icon={faUsers} /> Accesso
        </button>
        <button
          onClick={onShare}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <Icon icon={faLink} /> Condividi
        </button>
        <button
          onClick={onRename}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <Icon icon={faPen} /> Rinomina
        </button>
        <a
          href={file.url}
          download={file.name}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <Icon icon={faDownload} /> Download
        </a>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg border border-rose-500/15 bg-red-500/5 px-3 py-2 text-xs text-rose-400/60 transition-colors hover:text-rose-400"
        >
          <Icon icon={faTrash} /> Elimina
        </button>
      </div>
    </div>
  );
}

/* ─── List row ────────────────────────────────────────────────────────────── */
function ListRow({
  file,
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
  return (
    <tr
      className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onPreview}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded">
            <FileThumbnail file={file} />
          </div>
          <span className="max-w-xs truncate text-sm text-white/80">
            {file.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs capitalize text-white/50">
          {file.folder}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-white/40">
        {formatBytes(file.size)}
      </td>
      <td className="px-4 py-3 text-xs text-white/40">
        {file.uploadedByUsername}
      </td>
      <td className="px-4 py-3 text-xs text-white/40">
        {new Date(file.createdAt).toLocaleDateString("it-IT")}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="rounded p-1.5 text-white/40 hover:text-white transition-colors"
            title="Anteprima"
          >
            <Icon icon={faEye} className="text-xs" />
          </button>
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="rounded p-1.5 text-blue-400/50 hover:text-blue-400 transition-colors"
              title="Modifica testo"
            >
              <Icon icon={faFileCode} className="text-xs" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccess();
            }}
            className="rounded p-1.5 text-white/40 hover:text-white transition-colors"
            title="Gestione accesso"
          >
            <Icon icon={faUsers} className="text-xs" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="rounded p-1.5 text-white/40 hover:text-white transition-colors"
            title="Condividi"
          >
            <Icon icon={faLink} className="text-xs" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="rounded p-1.5 text-white/40 hover:text-white transition-colors"
            title="Rinomina"
          >
            <Icon icon={faPen} className="text-xs" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="rounded p-1.5 text-white/40 hover:text-white transition-colors"
            title="Duplica"
          >
            <Icon icon={faCopy} className="text-xs" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1.5 text-rose-400/50 hover:text-rose-400 transition-colors"
            title="Elimina"
          >
            <Icon icon={faTrash} className="text-xs" />
          </button>
        </div>
      </td>
    </tr>
  );
}
