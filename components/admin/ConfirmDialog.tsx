"use client";
import { AdminModal } from "./AdminModal";
import { useI18n } from "@/components/LocaleProvider";
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  dangerous = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <AdminModal open={open} title={title} onClose={onCancel} size="md">
      {description && (
        <p className="mb-6 break-words text-sm leading-relaxed text-white/50">
          {description}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button className="secondary-button" onClick={onCancel}>
          {t(cancelLabel)}
        </button>
        <button
          className={dangerous ? "danger-button" : "primary-button"}
          onClick={onConfirm}
        >
          {t(confirmLabel)}
        </button>
      </div>
    </AdminModal>
  );
}
