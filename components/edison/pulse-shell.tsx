"use client";

import type { ReactNode } from "react";
import {
  ChevronDown,
  CircleUserRound,
  Library,
  Pencil,
  Plus,
} from "lucide-react";
import { EdisonLogo } from "@/components/edison/brand";

export const PULSE_FOR_YOU_ID = "for-you" as const;

export interface PulseLoopNavItem {
  id: string;
  title: string;
  paused?: boolean;
}

export interface PulseShellProps {
  loops: readonly PulseLoopNavItem[];
  activeLoopId: string;
  children: ReactNode;
  onSelectLoop: (loopId: string) => void;
  onAddLoop: () => void;
  onOpenHome: () => void;
  onOpenLibrary: () => void;
  onOpenProfile: () => void;
  onOpenCurate: () => void;
  showLoopNavigation?: boolean;
  showCurate?: boolean;
  libraryLabel?: string;
  profileLabel?: string;
}

function LoopButton({
  loop,
  activeLoopId,
  onSelectLoop,
}: {
  loop: PulseLoopNavItem;
  activeLoopId: string;
  onSelectLoop: (loopId: string) => void;
}) {
  return (
    <button
      type="button"
      className="pulse-loop-tab"
      aria-current={activeLoopId === loop.id ? "page" : undefined}
      aria-label={loop.paused ? `${loop.title}, paused` : undefined}
      data-paused={loop.paused ? "true" : undefined}
      onClick={() => onSelectLoop(loop.id)}
    >
      <span>{loop.title}</span>
    </button>
  );
}

export function PulseShell({
  loops,
  activeLoopId,
  children,
  onSelectLoop,
  onAddLoop,
  onOpenHome,
  onOpenLibrary,
  onOpenProfile,
  onOpenCurate,
  showLoopNavigation = true,
  showCurate = true,
  libraryLabel = "Open Library",
  profileLabel = "Open Profile",
}: PulseShellProps) {
  const firstLoops = loops.slice(0, 2);
  const activeLoop = loops.find((loop) => loop.id === activeLoopId);
  const visibleLoops = activeLoop && !firstLoops.some((loop) => loop.id === activeLoop.id)
    ? [firstLoops[0], activeLoop].filter((loop): loop is PulseLoopNavItem => Boolean(loop))
    : firstLoops;
  const visibleIds = new Set(visibleLoops.map((loop) => loop.id));
  const overflowLoops = loops.filter((loop) => !visibleIds.has(loop.id));

  return (
    <div className="pulse-app">
      <div className="pulse-shell">
        <header className="pulse-masthead">
          <button
            type="button"
            className="pulse-logo"
            onClick={onOpenHome}
            aria-label="Edison home — For You"
          >
            <EdisonLogo />
          </button>

          <nav className="pulse-header-actions" aria-label="Your reading and account">
            <button
              type="button"
              className="pulse-icon-action"
              onClick={onOpenLibrary}
              aria-label={libraryLabel}
              title="Library"
            >
              <Library aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pulse-icon-action"
              onClick={onOpenProfile}
              aria-label={profileLabel}
              title="Profile"
            >
              <CircleUserRound aria-hidden="true" />
            </button>
          </nav>
        </header>

        {showLoopNavigation ? (
          <nav className="pulse-loop-navigation" aria-label="Your learning loops">
            <div className="pulse-loop-tabs">
              <LoopButton
                loop={{ id: PULSE_FOR_YOU_ID, title: "For You" }}
                activeLoopId={activeLoopId}
                onSelectLoop={onSelectLoop}
              />
              {visibleLoops.map((loop) => (
                <LoopButton
                  key={loop.id}
                  loop={loop}
                  activeLoopId={activeLoopId}
                  onSelectLoop={onSelectLoop}
                />
              ))}
              {overflowLoops.length > 0 ? (
                <details className="pulse-loop-overflow">
                  <summary>
                    <span>More</span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="pulse-loop-menu">
                    {overflowLoops.map((loop) => (
                      <LoopButton
                        key={loop.id}
                        loop={loop}
                        activeLoopId={activeLoopId}
                        onSelectLoop={(loopId) => {
                          const details = document.activeElement?.closest("details");
                          details?.removeAttribute("open");
                          onSelectLoop(loopId);
                        }}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
              <button
                type="button"
                className="pulse-add-loop"
                onClick={onAddLoop}
                aria-label="Add a learning loop"
              >
                <Plus aria-hidden="true" />
                <span>New loop</span>
              </button>
            </div>
          </nav>
        ) : null}

        <div className="pulse-main">{children}</div>

        {showCurate ? (
          <button
            type="button"
            className="pulse-curate-fab"
            onClick={onOpenCurate}
            aria-label="Curate your reading"
          >
            <Pencil aria-hidden="true" />
            <span>Curate</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
