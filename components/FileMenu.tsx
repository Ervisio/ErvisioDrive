"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Icon } from "@/components/ui/Icon";
import { useI18n } from "@/components/LocaleProvider";

export interface FileMenuItem {
  label: string;
  icon: IconDefinition;
  action?: () => void;
  danger?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
}

/** Where the menu opens: under a trigger element or at the pointer. */
export type MenuAnchor = { x: number; y: number; alignRight?: boolean };

export const anchorFromElement = (el: HTMLElement): MenuAnchor => {
  const rect = el.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom + 4, alignRight: true };
};

const GAP = 8;

/** Context menu for a file, rendered in a portal so cards never clip it. */
export function FileMenu({
  anchor,
  label,
  quick = [],
  items,
  onClose,
}: {
  anchor: MenuAnchor;
  label: string;
  /** Frequent actions shown as round buttons above the list. */
  quick?: FileMenuItem[];
  items: FileMenuItem[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const visible = items.filter((item) => item.action),
    quickVisible = quick.filter((item) => item.action);

  // Keep the menu inside the viewport, flipping above the anchor when needed.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    let left = anchor.alignRight ? anchor.x - width : anchor.x,
      top = anchor.y;
    if (top + height > window.innerHeight - GAP)
      top = Math.max(GAP, (anchor.alignRight ? anchor.y - 48 : anchor.y) - height);
    left = Math.min(Math.max(GAP, left), window.innerWidth - width - GAP);
    setPosition({ left, top });
  }, [anchor]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        previous?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const moveFocus = (event: React.KeyboardEvent) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : event.key === "ArrowUp"
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={moveFocus}
      onContextMenu={(e) => e.preventDefault()}
      className={`menu-popover file-menu ${quickVisible.length ? "has-quick" : ""}`}
      style={{
        position: "fixed",
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.y,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {quickVisible.length > 0 && (
        <div
          className="file-menu-quick"
          style={{ gridTemplateColumns: `repeat(${quickVisible.length}, minmax(0, 1fr))` }}
        >
          {quickVisible.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                onClose();
                item.action?.();
              }}
            >
              <span>
                <Icon icon={item.icon} />
              </span>
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
      {visible.map((item, index) => (
        <button
          key={item.label}
          role="menuitem"
          className={`${item.danger ? "danger" : ""} ${item.separated || (index === 0 && quickVisible.length) ? "separated" : ""}`}
          onClick={() => {
            onClose();
            item.action?.();
          }}
        >
          <Icon icon={item.icon} className="w-4" />
          {t(item.label)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
