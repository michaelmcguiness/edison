"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep contextual controls inside the visual viewport when a phone keyboard opens. */
export function useReaderViewport<T extends HTMLElement>(open: boolean, kind: "panel" | "page" | "dock") {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const bottom = Math.max(0, window.innerHeight - top - height);
      if (kind === "page") { element.style.top = `${top}px`; element.style.height = `${height}px`; }
      else if (kind === "dock") element.style.bottom = `${bottom}px`;
      else {
        element.style.bottom = `${bottom + (bottom > 100 ? 12 : 88)}px`;
        element.style.maxHeight = `${Math.max(100, height - (bottom > 100 ? 24 : 108))}px`;
      }
    };
    update(); viewport?.addEventListener("resize", update); viewport?.addEventListener("scroll", update); window.addEventListener("resize", update);
    return () => { viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [open, kind]);
  return ref;
}
