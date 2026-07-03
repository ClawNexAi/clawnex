import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "@/lib/config";

export type HermesPathResult = { ok: true; path: string } | { ok: false; error: string; path: string };

const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function expandHermesHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export function resolveHermesHomePath(input: string = config.hermes.home): HermesPathResult {
  const expanded = expandHermesHome(input || config.hermes.home);
  const resolved = path.resolve(expanded);
  const home = path.resolve(os.homedir());

  if (!isPathInside(home, resolved)) {
    return { ok: false, path: resolved, error: "Hermes home path must stay inside this user's home directory" };
  }

  try {
    const realHome = fs.realpathSync(home);
    const realResolved = hermesPathExists(resolved) ? fs.realpathSync(resolved) : resolved;
    if (!isPathInside(realHome, realResolved)) {
      return { ok: false, path: resolved, error: "Hermes home path resolves outside this user's home directory" };
    }
    return { ok: true, path: realResolved };
  } catch {
    return { ok: false, path: resolved, error: "Hermes home path could not be canonicalized safely" };
  }
}

export function isSafeHermesProfileId(profileId: string): boolean {
  return PROFILE_ID_RE.test(profileId) && !profileId.includes("/") && !profileId.includes("\\") && profileId !== "." && profileId !== "..";
}

export function isSafeHermesPathSegment(segment: string): boolean {
  return segment.length > 0 && !segment.includes("/") && !segment.includes("\\") && segment !== "." && segment !== "..";
}

export function resolveHermesChildPath(home: string, ...segments: string[]): HermesPathResult {
  if (!segments.every(isSafeHermesPathSegment)) {
    const unsafePath = path.resolve(home, ...segments);
    return { ok: false, path: unsafePath, error: "Hermes path contains an unsafe path segment" };
  }

  const root = path.resolve(home);
  const resolved = path.resolve(root, ...segments);
  if (!isPathInside(root, resolved)) {
    return { ok: false, path: resolved, error: "Hermes path escapes the Hermes home directory" };
  }

  try {
    const realRoot = hermesPathExists(root) ? fs.realpathSync(root) : root;
    const realResolved = hermesPathExists(resolved) ? fs.realpathSync(resolved) : resolved;
    if (!isPathInside(realRoot, realResolved)) {
      return { ok: false, path: resolved, error: "Hermes path resolves outside the Hermes home directory" };
    }
  } catch {
    return { ok: false, path: resolved, error: "Hermes path could not be canonicalized safely" };
  }

  return { ok: true, path: resolved };
}

export function resolveHermesProfilePath(home: string, profileId: string): HermesPathResult {
  if (!isSafeHermesProfileId(profileId)) {
    const unsafePath = path.resolve(home, "profiles", profileId);
    return { ok: false, path: unsafePath, error: "Hermes profile id contains unsafe characters" };
  }
  return resolveHermesChildPath(home, "profiles", profileId);
}

export function hermesPathExists(filePath: string): boolean {
  // Callers must pass paths returned by resolveHermesHomePath/resolveHermesChildPath.
  // codeql[js/path-injection]
  return fs.existsSync(filePath);
}

export function readHermesTextFile(filePath: string): string {
  // Callers must pass paths returned by resolveHermesHomePath/resolveHermesChildPath.
  // codeql[js/path-injection]
  return fs.readFileSync(filePath, "utf8");
}

export function readHermesDirectory(filePath: string): fs.Dirent[] {
  // Callers must pass paths returned by resolveHermesHomePath/resolveHermesChildPath.
  // codeql[js/path-injection]
  return fs.readdirSync(filePath, { withFileTypes: true });
}
