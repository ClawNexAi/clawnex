"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, F } from "./constants";

export interface GlobalFilterOption {
  value: string;
  label: string;
}

interface GlobalFilterSelectProps {
  ariaLabel: string;
  value: string;
  options: GlobalFilterOption[];
  onChange: (value: string) => void;
  accent?: string;
  minWidth?: number;
}

export function GlobalFilterSelect({
  ariaLabel,
  value,
  options,
  onChange,
  accent = C.cyan,
  minWidth = 160,
}: GlobalFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: minWidth });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/:/g, "");
  const listboxId = `${baseId}-listbox`;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex] ?? options[0];
  const activeAccent = value === "all" ? C.txS : accent;

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const longestLabel = options.reduce((longest, option) => Math.max(longest, option.label.length), 0);
      const width = Math.min(Math.max(rect.width, longestLabel * 8 + 52), 440, window.innerWidth - 16);
      setMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 5,
        width,
      });
    };
    updatePosition();
    window.requestAnimationFrame(() => listboxRef.current?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (highlightedIndex < options.length) return;
    setHighlightedIndex(Math.max(0, options.length - 1));
  }, [highlightedIndex, options.length]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setHighlightedIndex((current) => (current + direction + options.length) % options.length);
  };

  const openFromTrigger = (index: number) => {
    setHighlightedIndex(Math.max(0, Math.min(index, options.length - 1)));
    setOpen(true);
  };

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? "No selection"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => open ? setOpen(false) : openFromTrigger(selectedIndex)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openFromTrigger(selectedIndex + 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openFromTrigger(selectedIndex - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            openFromTrigger(0);
          } else if (event.key === "End") {
            event.preventDefault();
            openFromTrigger(options.length - 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        style={{
          width: "100%", minHeight: 30, padding: "4px 9px 4px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          background: open ? C.glassPanelNested : C.glassSurfTrans,
          border: `1px solid ${open || value !== "all" ? `${activeAccent}88` : C.glassSurfBorder}`,
          borderRadius: 6, color: activeAccent, cursor: "pointer",
          fontFamily: F.mono, fontSize: 14, textAlign: "left",
          boxShadow: open ? `0 0 0 2px ${activeAccent}18` : "none",
          transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedOption?.label ?? "No options"}
        </span>
        <span aria-hidden="true" style={{ color: open ? accent : C.txG, fontSize: 10, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
          ▼
        </span>
      </button>

      {open && createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={`${baseId}-option-${highlightedIndex}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveHighlight(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveHighlight(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              setHighlightedIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setHighlightedIndex(Math.max(0, options.length - 1));
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(highlightedIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
          style={{
            position: "fixed", top: menuPosition.top, left: menuPosition.left, zIndex: 1000,
            width: menuPosition.width, maxWidth: "calc(100vw - 16px)",
            maxHeight: 300, overflowY: "auto", padding: 5,
            background: C.bgS, border: `1px solid ${C.glassBorderCyanStrong}`, borderRadius: 6,
            boxShadow: C.glassShadow, outline: "none",
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === highlightedIndex;
            return (
              <div
                key={`${option.value}-${index}`}
                id={`${baseId}-option-${index}`}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setHighlightedIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                style={{
                  minHeight: 32, padding: "6px 9px", borderRadius: 4,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                  background: highlighted ? `${accent}18` : selected ? C.glassSurfTrans : "transparent",
                  border: `1px solid ${highlighted ? `${accent}44` : "transparent"}`,
                  color: selected ? accent : C.txS, cursor: "pointer",
                  fontFamily: F.mono, fontSize: 13, whiteSpace: "nowrap",
                }}
              >
                <span>{option.label}</span>
                {selected && <span aria-hidden="true" style={{ color: accent, fontWeight: 800 }}>✓</span>}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
