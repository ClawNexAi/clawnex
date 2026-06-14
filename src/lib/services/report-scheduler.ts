/**
 * Report Scheduler Service
 *
 * Manages scheduled report generation with on/off toggle.
 * Jobs are stored in config_defaults and executed by an in-process timer.
 */

import { queryAll, queryOne, run } from '../db/index';
import { getSetting } from './config-service';

export interface ScheduledJob {
  id: string;
  report_type: string;
  schedule: string; // cron-like: 'daily', 'weekly', 'monthly'
  format: string;
  email_to: string;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
}

// In-process timer references
const activeTimers = new Map<string, NodeJS.Timeout>();

/**
 * Get all scheduled report jobs.
 */
export function getScheduledJobs(): ScheduledJob[] {
  const raw = getSetting('scheduled_reports');
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ScheduledJob[];
  } catch {
    return [];
  }
}

/**
 * Save scheduled report jobs.
 */
function saveJobs(jobs: ScheduledJob[]): void {
  run(
    "INSERT OR REPLACE INTO config_defaults (key, value) VALUES ('scheduled_reports', ?)",
    [JSON.stringify(jobs)]
  );
}

/**
 * Create a new scheduled report job.
 */
export function createJob(params: {
  report_type: string;
  schedule: string;
  format: string;
  email_to: string;
}): ScheduledJob {
  const jobs = getScheduledJobs();
  const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const job: ScheduledJob = {
    id,
    report_type: params.report_type,
    schedule: params.schedule,
    format: params.format || 'markdown',
    email_to: params.email_to || '',
    enabled: true,
    next_run: calculateNextRun(params.schedule),
  };

  jobs.push(job);
  saveJobs(jobs);
  startJobTimer(job);

  return job;
}

/**
 * Toggle a job on or off.
 */
export function toggleJob(jobId: string, enabled: boolean): ScheduledJob | null {
  const jobs = getScheduledJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return null;

  job.enabled = enabled;

  if (enabled) {
    job.next_run = calculateNextRun(job.schedule);
    startJobTimer(job);
  } else {
    stopJobTimer(jobId);
    job.next_run = undefined;
  }

  saveJobs(jobs);
  return job;
}

/**
 * Delete a scheduled job.
 */
export function deleteJob(jobId: string): boolean {
  const jobs = getScheduledJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return false;

  stopJobTimer(jobId);
  jobs.splice(idx, 1);
  saveJobs(jobs);
  return true;
}

/**
 * Calculate next run time based on schedule.
 */
function calculateNextRun(schedule: string): string {
  const now = new Date();

  switch (schedule) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      now.setHours(6, 0, 0, 0); // 6 AM next day
      break;
    case 'weekly':
      now.setDate(now.getDate() + (7 - now.getDay())); // Next Sunday
      now.setHours(6, 0, 0, 0);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(6, 0, 0, 0);
      break;
    default:
      now.setDate(now.getDate() + 1);
      now.setHours(6, 0, 0, 0);
  }

  return now.toISOString();
}

/**
 * Get interval in ms for a schedule.
 */
function scheduleToMs(schedule: string): number {
  switch (schedule) {
    case 'daily': return 24 * 60 * 60 * 1000;
    case 'weekly': return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

/**
 * Start a timer for a job.
 */
function startJobTimer(job: ScheduledJob): void {
  stopJobTimer(job.id);

  if (!job.enabled) return;

  const intervalMs = scheduleToMs(job.schedule);

  // Calculate delay until next run
  const nextRun = job.next_run ? new Date(job.next_run).getTime() : Date.now() + intervalMs;
  const delay = Math.max(nextRun - Date.now(), 60000); // At least 1 minute

  const timer = setTimeout(async () => {
    await executeJob(job);

    // Schedule next run
    job.last_run = new Date().toISOString();
    job.next_run = calculateNextRun(job.schedule);

    const jobs = getScheduledJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx !== -1) {
      jobs[idx] = job;
      saveJobs(jobs);
    }

    // Restart timer for next run
    if (job.enabled) {
      startJobTimer(job);
    }
  }, delay);

  activeTimers.set(job.id, timer);
}

/**
 * Stop a job timer.
 */
function stopJobTimer(jobId: string): void {
  const timer = activeTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(jobId);
  }
}

/**
 * Execute a scheduled job — generate report and optionally email it.
 */
async function executeJob(job: ScheduledJob): Promise<void> {
  try {
    // Generate the report via internal API
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 5001}/api/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: job.report_type,
        format: job.format,
        timeRange: job.schedule === 'daily' ? '24h' : job.schedule === 'weekly' ? '7d' : '30d',
      }),
    });

    if (!res.ok) {
      console.error(`[ReportScheduler] Failed to generate ${job.report_type}: HTTP ${res.status}`);
      return;
    }

    const report = await res.json();

    // If email_to is configured, send the report
    if (job.email_to) {
      try {
        const { sendMail } = await import('./mail-service');
        await sendMail({
          to: job.email_to,
          subject: `ClawNex Scheduled Report: ${job.report_type.replace(/_/g, ' ')}`,
          html: `<pre style="font-family:monospace;font-size:13px;background:#04070e;color:#e5eaf3;padding:20px;border-radius:8px;overflow-x:auto">${
            typeof report.content === 'string' ? report.content : JSON.stringify(report, null, 2)
          }</pre>`,
        });
      } catch (mailErr) {
        console.error(`[ReportScheduler] Failed to email report: ${mailErr}`);
      }
    }

    console.log(`[ReportScheduler] Generated ${job.report_type} (${job.format}) — ${job.email_to ? 'emailed to ' + job.email_to : 'no email'}`);
  } catch (err) {
    console.error(`[ReportScheduler] Error executing job ${job.id}: ${err}`);
  }
}

/**
 * Initialize scheduler — start timers for all enabled jobs.
 * Call this on server startup.
 */
export function initScheduler(): void {
  const jobs = getScheduledJobs();
  let started = 0;
  for (const job of jobs) {
    if (job.enabled) {
      startJobTimer(job);
      started++;
    }
  }
  if (started > 0) {
    console.log(`[ReportScheduler] Started ${started} scheduled job(s)`);
  }
}
