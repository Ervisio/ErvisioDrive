"use client";
import { useEffect, useRef, useId } from "react";
import { useI18n } from "@/components/LocaleProvider";
interface AdminModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
  /** dialog: centered; full: covers the viewport; panel: slides in from the right. */
  variant?: "dialog" | "full" | "panel";
  /** Extra buttons shown before the close button. */
  actions?: React.ReactNode;
}
export function AdminModal({
  open,
  title,
  onClose,
  children,
  size = "lg",
  variant = "dialog",
  actions,
}: AdminModalProps) {
  const { t } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null),
    heading = useId();
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      const old = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = old;
        dialog.current?.close();
      };
    }
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby={heading}
      className={`app-dialog ${variant !== "dialog" ? `is-${variant}` : size === "md" ? "sm:max-w-lg" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-4xl"}`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-sheet px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
        <h2 id={heading} className="min-w-0 break-words text-lg font-medium">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            aria-label={t("Close")}
            onClick={onClose}
            className="icon-button h-11 w-11 text-xl"
          >
            ×
          </button>
        </div>
      </div>
      <div className="modal-body p-4 sm:p-6">{children}</div>
    </dialog>
  );
}
