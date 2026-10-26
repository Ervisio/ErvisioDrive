"use client";

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
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  dangerous = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[admin-fade-in_0.15s_ease-out]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#111118] p-6 shadow-2xl animate-[admin-slide-up_0.2s_ease-out]">
        <h3 className="text-base font-semibold tracking-tight text-white">
          {title}
        </h3>
        {description && (
          <p className="mt-2 text-sm text-white/50">{description}</p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-white/[0.06] px-4 py-2.5 text-sm text-white/50 transition-all hover:bg-white/[0.04] hover:text-white"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              dangerous
                ? "bg-gradient-to-r from-rose-600 to-rose-500 text-white hover:from-rose-500 hover:to-rose-400 shadow-lg shadow-rose-500/20"
                : "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-500/20"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
