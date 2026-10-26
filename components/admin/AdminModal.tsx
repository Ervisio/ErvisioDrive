"use client";
import { useEffect, useRef, useId } from "react";
import { useI18n } from "@/components/LocaleProvider";
interface AdminModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
}
export function AdminModal({
  open,
  title,
  onClose,
  children,
  size = "lg",
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
      className={`app-dialog ${size === "md" ? "sm:max-w-lg" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-4xl"}`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-[#111118] px-4 py-3 sm:px-6">
        <h2 id={heading} className="min-w-0 break-words text-sm font-semibold">
          {title}
        </h2>
        <button
          aria-label={t("Close")}
          onClick={onClose}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/5 text-xl text-white/50"
        >
          ×
        </button>
      </div>
      <div className="modal-body p-4 sm:p-6">{children}</div>
    </dialog>
  );
}
