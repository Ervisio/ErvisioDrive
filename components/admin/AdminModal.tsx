"use client";

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
  if (!open) return null;

  const widthClass =
    size === "md" ? "max-w-lg" : size === "lg" ? "max-w-2xl" : "max-w-4xl";

  return (
    <div className="fixed inset-0 z-50 animate-[admin-fade-in_0.15s_ease-out]">
      {/* Backdrop — always full-screen, never scrolls */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Scroll container — pointer-events-none so clicks fall through to backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-y-auto flex items-start justify-center p-4 pt-16">
        <div
          className={`pointer-events-auto relative w-full ${widthClass} rounded-2xl border border-white/[0.06] bg-[#111118] shadow-2xl my-4 animate-[admin-slide-up_0.2s_ease-out]`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.04] px-6 py-4">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-white/30 transition-all hover:bg-white/[0.04] hover:text-orange-400"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          {/* Body */}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
