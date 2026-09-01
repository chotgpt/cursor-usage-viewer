/*
 * Derived from Cockpit Tools at a0508ae815e104e931dae515389e680840008367.
 * Source: src/hooks/useDropdownPanelPlacement.ts.
 * CC BY-NC-SA 4.0; see docs/UPSTREAM_COCKPIT_UI.md.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 12;
const PANEL_PADDING_BUFFER = 20;

export function useDropdownPanelPlacement(rootRef: RefObject<HTMLElement | null>, open: boolean, dependencyKey?: unknown) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPlacement, setPanelPlacement] = useState<"top" | "bottom">("bottom");
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPlacement("bottom");
      setPanelMaxHeight(null);
      return;
    }
    const updatePanelPosition = (event?: Event) => {
      const rootElement = rootRef.current;
      const panelElement = panelRef.current;
      if (!rootElement || !panelElement) return;
      const eventTarget = event?.target;
      if (event?.type === "scroll" && eventTarget instanceof Node && panelElement.contains(eventTarget)) return;
      const rootRect = rootElement.getBoundingClientRect();
      const panelHeight = panelElement.scrollHeight || panelElement.offsetHeight;
      const availableBelow = window.innerHeight - rootRect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
      const availableAbove = rootRect.top - PANEL_GAP - VIEWPORT_MARGIN;
      const nextPlacement = availableBelow < panelHeight && availableAbove > availableBelow ? "top" : "bottom";
      const availableSpace = nextPlacement === "top" ? availableAbove : availableBelow;
      const nextMaxHeight = Math.max(48, Math.floor(availableSpace - PANEL_PADDING_BUFFER));
      setPanelPlacement((previous) => previous === nextPlacement ? previous : nextPlacement);
      setPanelMaxHeight((previous) => previous === nextMaxHeight ? previous : nextMaxHeight);
    };
    const frameId = window.requestAnimationFrame(() => updatePanelPosition());
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [dependencyKey, open, rootRef]);

  const scrollContainerStyle: CSSProperties | undefined = panelMaxHeight == null ? undefined : { maxHeight: `${panelMaxHeight}px`, overflowY: "auto" };
  return { panelRef, panelPlacement, scrollContainerStyle };
}
