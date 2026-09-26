"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: labelled by its title, traps Tab focus, closes on Escape or a backdrop click
 * (unless `busy`), focuses the first field on open and returns focus to whatever opened it.
 * Sheets up from the bottom on phones, centred on larger screens.
 */
export function Dialog({ title, description, onClose, busy = false, children, footer }: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  useEffect(() => { busyRef.current = busy; onCloseRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>("input, select, textarea") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => { if (!busy) onClose(); }}>
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-panel)] bg-white shadow-xl outline-none sm:rounded-[var(--radius-panel)]"
        onClick={(event) => event.stopPropagation()}
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 className="text-lg font-semibold text-ink" id={titleId}>{title}</h2>
          {description && <div className="mt-1.5 text-sm leading-6 text-muted" id={descriptionId}>{description}</div>}
        </div>
        {children && <div className="px-5 pt-4 sm:px-6">{children}</div>}
        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-hairline px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div>
      </div>
    </div>
  );
}
