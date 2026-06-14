/**
 * System Metrics Collector
 *
 * Uses Node.js os module for CPU and memory metrics,
 * and child_process for disk usage (df -h).
 */

import os from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  cpuUsage: number;
  memTotal: string;
  memUsed: string;
  memFree: string;
  memUsage: number;
  uptime: string;
  loadAvg: number[];
  nodeVersion: string;
}

export interface DiskMetric {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usePct: string;
  mount: string;
}

export interface FullSystemReport {
  system: SystemMetrics;
  disk: DiskMetric[];
  collectedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Estimate CPU usage by sampling /proc/stat or by measuring idle time.
 * On macOS, we use a simple load-average based heuristic.
 */
function getCpuUsage(): number {
  const cpus = os.cpus();
  const coreCount = cpus.length || 1;

  // Use 1-minute load average as a proxy
  const load1 = os.loadavg()[0];
  // Normalize to percentage (load of 1.0 on 4 cores = 25%)
  const usage = Math.min(100, Math.round((load1 / coreCount) * 100));
  return usage;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect system metrics (CPU, memory, platform info).
 */
export function getSystemMetrics(): SystemMetrics {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || "Unknown",
    cpuCores: cpus.length,
    cpuUsage: getCpuUsage(),
    memTotal: formatBytes(totalMem),
    memUsed: formatBytes(usedMem),
    memFree: formatBytes(freeMem),
    memUsage: Math.round((usedMem / totalMem) * 100),
    uptime: formatUptime(os.uptime()),
    loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    nodeVersion: process.version,
  };
}

/**
 * Collect disk usage via `df -h`.
 * Filters to physical filesystems only (excludes tmpfs, devfs, etc.).
 */
export function getDiskMetrics(): DiskMetric[] {
  try {
    const output = execSync("df -h", { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n").slice(1); // Skip header

    const disks: DiskMetric[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const filesystem = parts[0];
      // Filter out non-physical filesystems
      if (
        filesystem === "devfs" ||
        filesystem === "tmpfs" ||
        filesystem === "map" ||
        filesystem.startsWith("map ") ||
        filesystem === "none"
      ) {
        continue;
      }

      // On macOS, df output: Filesystem Size Used Avail Capacity iused ifree %iused Mounted
      // On Linux: Filesystem Size Used Avail Use% Mounted
      const isMac = os.type() === "Darwin";

      if (isMac && parts.length >= 9) {
        disks.push({
          filesystem,
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePct: parts[4],
          mount: parts.slice(8).join(" "),
        });
      } else if (parts.length >= 6) {
        disks.push({
          filesystem,
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePct: parts[4],
          mount: parts.slice(5).join(" "),
        });
      }
    }

    return disks;
  } catch (err) {
    console.error("[System Metrics] Failed to get disk metrics:", err);
    return [];
  }
}

/**
 * Collect full system report (CPU, memory, disk).
 */
export function getFullSystemReport(): FullSystemReport {
  return {
    system: getSystemMetrics(),
    disk: getDiskMetrics(),
    collectedAt: new Date().toISOString(),
  };
}
