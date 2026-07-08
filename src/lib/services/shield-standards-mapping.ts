import type { ShieldDetection, ShieldScanResult } from "@/lib/types";

export type StandardFramework = "mitre-atlas" | "owasp-llm-top-10" | "nist-ai-rmf";

export interface StandardMapping {
  framework: StandardFramework;
  id: string;
  name: string;
  url: string;
}

export interface DetectionWithMappings extends ShieldDetection {
  standards?: StandardMapping[];
}

const OWASP_BASE = "https://owasp.org/www-project-top-10-for-large-language-model-applications/";
const NIST_BASE = "https://www.nist.gov/itl/ai-risk-management-framework";
const ATLAS_BASE = "https://atlas.mitre.org/";

const CATEGORY_MAPPINGS: Record<string, StandardMapping[]> = {
  jailbreak: [
    { framework: "owasp-llm-top-10", id: "LLM01", name: "Prompt Injection", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0051", name: "LLM Prompt Injection", url: ATLAS_BASE },
    { framework: "nist-ai-rmf", id: "MAP", name: "Context and risk mapping", url: NIST_BASE },
  ],
  "trust-exploit": [
    { framework: "owasp-llm-top-10", id: "LLM01", name: "Prompt Injection", url: OWASP_BASE },
    { framework: "owasp-llm-top-10", id: "LLM06", name: "Excessive Agency", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0051", name: "LLM Prompt Injection", url: ATLAS_BASE },
  ],
  secrets: [
    { framework: "owasp-llm-top-10", id: "LLM02", name: "Sensitive Information Disclosure", url: OWASP_BASE },
    { framework: "nist-ai-rmf", id: "MANAGE", name: "Risk response and mitigation", url: NIST_BASE },
  ],
  "outbound-leak": [
    { framework: "owasp-llm-top-10", id: "LLM02", name: "Sensitive Information Disclosure", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0024", name: "Exfiltration", url: ATLAS_BASE },
  ],
  "sensitive-path": [
    { framework: "owasp-llm-top-10", id: "LLM02", name: "Sensitive Information Disclosure", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0024", name: "Exfiltration", url: ATLAS_BASE },
  ],
  c2: [
    { framework: "mitre-atlas", id: "AML.T0040", name: "Command and Control", url: ATLAS_BASE },
    { framework: "owasp-llm-top-10", id: "LLM06", name: "Excessive Agency", url: OWASP_BASE },
  ],
  commands: [
    { framework: "owasp-llm-top-10", id: "LLM06", name: "Excessive Agency", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0005", name: "Command Execution", url: ATLAS_BASE },
  ],
  "cognitive-tampering": [
    { framework: "owasp-llm-top-10", id: "LLM01", name: "Prompt Injection", url: OWASP_BASE },
    { framework: "owasp-llm-top-10", id: "LLM08", name: "Vector and Embedding Weaknesses", url: OWASP_BASE },
  ],
  steganography: [
    { framework: "owasp-llm-top-10", id: "LLM01", name: "Prompt Injection", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0051", name: "LLM Prompt Injection", url: ATLAS_BASE },
  ],
  encoding: [
    { framework: "owasp-llm-top-10", id: "LLM01", name: "Prompt Injection", url: OWASP_BASE },
    { framework: "mitre-atlas", id: "AML.T0051", name: "LLM Prompt Injection", url: ATLAS_BASE },
  ],
  financial: [
    { framework: "owasp-llm-top-10", id: "LLM02", name: "Sensitive Information Disclosure", url: OWASP_BASE },
    { framework: "nist-ai-rmf", id: "MEASURE", name: "Risk measurement", url: NIST_BASE },
  ],
  policy: [
    { framework: "nist-ai-rmf", id: "GOVERN", name: "Governance and accountability", url: NIST_BASE },
  ],
};

function uniqueMappings(mappings: StandardMapping[]): StandardMapping[] {
  const seen = new Set<string>();
  const out: StandardMapping[] = [];
  for (const mapping of mappings) {
    const key = `${mapping.framework}:${mapping.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapping);
  }
  return out;
}

export function mappingsForDetection(detection: Pick<ShieldDetection, "id" | "category" | "rule_key" | "tags">): StandardMapping[] {
  const category = detection.category.toLowerCase();
  const mappings = [...(CATEGORY_MAPPINGS[category] || [])];
  const key = (detection.rule_key || detection.id || "").toUpperCase();
  if (key.includes("PII") || key.includes("SECRET") || key.includes("PASSWORD") || key.includes("KEY")) {
    mappings.push({ framework: "owasp-llm-top-10", id: "LLM02", name: "Sensitive Information Disclosure", url: OWASP_BASE });
  }
  if (key.includes("TOOL") || key.includes("COMMAND") || key.includes("EXEC")) {
    mappings.push({ framework: "owasp-llm-top-10", id: "LLM06", name: "Excessive Agency", url: OWASP_BASE });
  }
  if (detection.tags?.includes("policy-framework")) {
    mappings.push({ framework: "nist-ai-rmf", id: "GOVERN", name: "Governance and accountability", url: NIST_BASE });
  }
  return uniqueMappings(mappings);
}

export function enrichDetections<T extends ShieldDetection>(detections: T[]): Array<T & { standards: StandardMapping[] }> {
  return detections.map((detection) => ({
    ...detection,
    standards: mappingsForDetection(detection),
  }));
}

export function enrichScanResult<T extends ShieldScanResult>(result: T): T & { standards: StandardMapping[] } {
  const detections = enrichDetections(result.detections);
  return {
    ...result,
    detections,
    standards: uniqueMappings(detections.flatMap((detection) => detection.standards)),
  };
}

