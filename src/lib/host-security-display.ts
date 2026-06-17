export function formatHostSecurityCheckId(checkId: string | null | undefined): string {
  if (!checkId) return "";
  return checkId.replace(/^CK-(\d+)$/i, "HS-$1");
}

export function formatHostSecurityTitle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .replace(/\bClawkeeper:/gi, "Host Security:")
    .replace(/\bClawkeeper\b/gi, "Host Security")
    .replace(/\bCK-(\d+)\b/g, "HS-$1");
}

export function formatHostSecuritySource(source: string | null | undefined): string {
  if (!source) return "";
  return source.toLowerCase() === "clawkeeper" ? "host-security" : source;
}
