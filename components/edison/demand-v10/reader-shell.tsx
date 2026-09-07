"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CircleUserRound, Library, Pencil, Plus } from "lucide-react";
import { EdisonLogo } from "@/components/edison/brand";
import { PULSE_FOR_YOU_ID } from "@/components/edison/pulse-shell";

export function loopOverflow(scrollLeft: number, clientWidth: number, scrollWidth: number) {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

export function ReaderShell({ loops, activeLoopId, children, onSelectLoop, onAddLoop, onOpenHome,
  onOpenLibrary, onOpenProfile, onEditLoop, showLoopNavigation, showEditLoop }: {
  loops: readonly { id: string; title: string }[];
  activeLoopId: string;
  children?: ReactNode;
  onSelectLoop: (id: string) => void;
  onAddLoop: () => void;
  onOpenHome: () => void;
  onOpenLibrary: () => void;
  onOpenProfile: () => void;
  onEditLoop: () => void;
  showLoopNavigation: boolean;
  showEditLoop: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setOverflow(loopOverflow(element.scrollLeft, element.clientWidth, element.scrollWidth));
    const selected = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.dataset.loopId === activeLoopId);
    if (selected) {
      const start = selected.offsetLeft - element.offsetLeft;
      if (start < element.scrollLeft) element.scrollLeft = start;
      else if (start + selected.offsetWidth > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = start + selected.offsetWidth - element.clientWidth;
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [activeLoopId, loops, showLoopNavigation]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(scroller.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
    buttons[next]?.focus();
  }

  return <div className="pulse-app demand-v10"><div className="pulse-shell">
    <header className="pulse-masthead">
      <button type="button" className="pulse-logo" onClick={onOpenHome} aria-label="Edison home — For You"><EdisonLogo /></button>
      <nav className="pulse-header-actions" aria-label="Your reading and account">
        <button type="button" className="pulse-icon-action" onClick={onOpenLibrary} aria-label="Open Library" title="Library"><Library aria-hidden="true" /></button>
        <button type="button" className="pulse-icon-action" onClick={onOpenProfile} aria-label="Open Profile" title="Profile"><CircleUserRound aria-hidden="true" /></button>
      </nav>
    </header>
    {showLoopNavigation ? <nav className="demand-loop-strip" aria-label="Your learning loops">
      {overflow.left ? <button type="button" className="demand-nav-chevron" aria-label="Scroll loops left" onClick={() => scroller.current?.scrollBy({ left: -240 })}><ChevronLeft aria-hidden="true" /></button> : null}
      <div className="demand-loop-scroller" ref={scroller} onKeyDown={moveFocus}>
        {[{ id: PULSE_FOR_YOU_ID, title: "For You" }, ...loops].map((loop) => <button key={loop.id} type="button" className="pulse-loop-tab" data-loop-id={loop.id}
          aria-current={activeLoopId === loop.id ? "page" : undefined} title={loop.title} onClick={() => onSelectLoop(loop.id)}><span>{loop.title}</span></button>)}
      </div>
      {overflow.right ? <button type="button" className="demand-nav-chevron" aria-label="Scroll loops right" onClick={() => scroller.current?.scrollBy({ left: 240 })}><ChevronRight aria-hidden="true" /></button> : null}
      <button type="button" className="demand-new-loop" onClick={onAddLoop} aria-label="Add a learning loop"><Plus aria-hidden="true" /><span>New loop</span></button>
    </nav> : null}
    <div className="pulse-main">{children}</div>
    {showEditLoop ? <button type="button" className="pulse-curate-fab" onClick={onEditLoop}><Pencil aria-hidden="true" /><span>Edit loop</span></button> : null}
  </div></div>;
}
