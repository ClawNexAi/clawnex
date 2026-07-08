import { getSetting, setSetting } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";

export type InspectionProfileId = "observe" | "balanced" | "strict" | "dlp-heavy" | "agentic-high-risk";
export type ReviewQueueMode = "post_facto" | "hold";

export interface InspectionProfile {
  id: InspectionProfileId;
  name: string;
  description: string;
  blockMode: "on" | "off";
  scanCategories: string[] | null;
  queueMode: ReviewQueueMode;
  alertReviewScore: number;
  alertBlockScore: number;
  outboundGate: "standard" | "strict" | "monitor";
}

export const INSPECTION_PROFILES: InspectionProfile[] = [
  {
    id: "observe",
    name: "Observe",
    description: "Scan and queue findings without active blocking. Best for first-run baselining.",
    blockMode: "off",
    scanCategories: null,
    queueMode: "post_facto",
    alertReviewScore: 35,
    alertBlockScore: 70,
    outboundGate: "monitor",
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Default production profile: scan all categories, block clear threats, queue REVIEW.",
    blockMode: "on",
    scanCategories: null,
    queueMode: "post_facto",
    alertReviewScore: 25,
    alertBlockScore: 60,
    outboundGate: "standard",
  },
  {
    id: "strict",
    name: "Strict",
    description: "Higher-sensitivity profile for active incidents and exposed systems.",
    blockMode: "on",
    scanCategories: null,
    queueMode: "post_facto",
    alertReviewScore: 20,
    alertBlockScore: 50,
    outboundGate: "strict",
  },
  {
    id: "dlp-heavy",
    name: "DLP-heavy",
    description: "Emphasizes secrets, sensitive paths, outbound leak, financial, and C2 detections.",
    blockMode: "on",
    scanCategories: ["secrets", "sensitive-path", "outbound-leak", "financial", "c2", "policy"],
    queueMode: "post_facto",
    alertReviewScore: 20,
    alertBlockScore: 50,
    outboundGate: "strict",
  },
  {
    id: "agentic-high-risk",
    name: "Agentic high-risk",
    description: "For tool-capable agents and broad reachability: all categories, stricter queue and alert posture.",
    blockMode: "on",
    scanCategories: null,
    queueMode: "post_facto",
    alertReviewScore: 20,
    alertBlockScore: 45,
    outboundGate: "strict",
  },
];

export function listInspectionProfiles(): InspectionProfile[] {
  return INSPECTION_PROFILES;
}

export function getInspectionProfile(id: string | null | undefined): InspectionProfile {
  return INSPECTION_PROFILES.find((profile) => profile.id === id) || INSPECTION_PROFILES[1];
}

export function getActiveInspectionProfile(): InspectionProfile {
  return getInspectionProfile(getSetting("shield_inspection_profile") || "balanced");
}

export function getActiveScanOptions(direction: "inbound" | "outbound"): { categories?: string[]; profileId: string } {
  const profile = getActiveInspectionProfile();
  if (direction === "inbound" && profile.scanCategories) {
    return { categories: profile.scanCategories, profileId: profile.id };
  }
  return { profileId: profile.id };
}

export function applyInspectionProfile(id: string, actor = "operator"): InspectionProfile {
  const profile = getInspectionProfile(id);
  setSetting("shield_inspection_profile", profile.id);
  setSetting("proxy_block_mode", profile.blockMode);
  setSetting("shield_profile_scan_categories", JSON.stringify(profile.scanCategories || []));
  setSetting("shield_review_queue_mode", profile.queueMode);
  setSetting("shield_alert_review_score", String(profile.alertReviewScore));
  setSetting("shield_alert_block_score", String(profile.alertBlockScore));
  setSetting("shield_outbound_gate", profile.outboundGate);
  logEvent(
    actor,
    "shield_profile_applied",
    "shield_profile",
    profile.id,
    `Applied inspection profile ${profile.name}`,
    "dashboard",
  );
  return profile;
}

