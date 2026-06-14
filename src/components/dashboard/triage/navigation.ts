import type { TabId } from "../types";
import type { NavigateOpts, UrlState } from "../url-state";
import type { TriageNavigationTarget } from "./types";

export type TriageNavigate = (tab: TabId, focusOrOpts?: string | NavigateOpts) => void;

export function withMissionControlContext(opts: NavigateOpts | undefined): NavigateOpts {
  if (typeof opts === "string") return { focus: opts, fromMissionControl: true };
  return { ...(opts ?? {}), fromMissionControl: true };
}

export function navigateToTriageTarget(
  onNavigate: TriageNavigate,
  target: TriageNavigationTarget,
  options: { fromMissionControl?: boolean } = {},
): void {
  const opts = options.fromMissionControl === false
    ? target.opts
    : withMissionControlContext(target.opts);
  onNavigate(target.tab, opts);
}

export function makeLastHoursFilter(hours: number, now = new Date()): Pick<UrlState, "min" | "max"> {
  const end = now.toISOString();
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  // Build a time-range filter via min/max fields
  const filter = { min: start, max: end };
  return filter;
}

export function makeQueryFilter(q: string): Pick<UrlState, "q"> {
  return { q };
}
