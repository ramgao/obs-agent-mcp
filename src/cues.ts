import { randomUUID } from 'node:crypto';
import type { ObsApi } from './obs.js';
import { AgentError, errorInfo, redact } from './errors.js';
import { validateRequest, type JsonObject } from './catalog.js';

export interface Cue { delayMs: number; requestType: string; requestData?: JsonObject }
interface CueJob {
  id: string; name: string; createdAt: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  cues: Cue[]; results: unknown[]; nextIndex: number; timer?: NodeJS.Timeout;
}

export class CueScheduler {
  private jobs = new Map<string, CueJob>();
  private closed = false;
  constructor(private obs: ObsApi) {}
  schedule(name: string, cues: Cue[]): unknown {
    if (this.closed) throw new AgentError('CLOSED', 'The cue scheduler is closed.');
    if (this.obs.config.readOnly) throw new AgentError('READ_ONLY', 'Cue scheduling is disabled by OBS_READ_ONLY.');
    if (this.jobs.size >= 200) {
      for (const [id, job] of this.jobs) if (['completed', 'failed', 'cancelled'].includes(job.status)) { this.jobs.delete(id); break; }
      if (this.jobs.size >= 200) throw new AgentError('CUE_LIMIT', 'Cancel or finish existing cue jobs before scheduling more.');
    }
    for (const cue of cues) validateRequest(cue.requestType, cue.requestData ?? {}, this.obs.config.readOnly);
    const job: CueJob = { id: randomUUID(), name, createdAt: new Date().toISOString(), status: 'pending', cues: structuredClone(cues).sort((a, b) => a.delayMs - b.delayMs), results: [], nextIndex: 0 };
    this.jobs.set(job.id, job);
    this.arm(job);
    return this.snapshot(job);
  }
  private arm(job: CueJob): void {
    const cue = job.cues[job.nextIndex];
    if (!cue) { job.status = 'completed'; return; }
    const due = new Date(job.createdAt).getTime() + cue.delayMs;
    job.timer = setTimeout(() => { void this.run(job, cue); }, Math.max(0, due - Date.now()));
    job.timer.unref();
  }
  private async run(job: CueJob, cue: Cue): Promise<void> {
    if (job.status === 'cancelled' || this.closed) return;
    job.status = 'running';
    try {
      const data = await this.obs.request(cue.requestType, cue.requestData);
      job.results.push({ index: job.nextIndex, ok: true, time: new Date().toISOString(), data: redact(data, this.obs.config.password) });
      job.nextIndex++;
      if ((job.status as string) !== 'cancelled' && !this.closed) { job.status = 'pending'; this.arm(job); }
    } catch (error) {
      job.results.push({ index: job.nextIndex, ok: false, time: new Date().toISOString(), error: errorInfo(error, this.obs.config.password) });
      if ((job.status as string) !== 'cancelled') job.status = 'failed';
    }
  }
  private snapshot(job: CueJob): unknown {
    const { timer: _timer, ...data } = job;
    return redact(structuredClone(data), this.obs.config.password);
  }
  list(): unknown[] { return [...this.jobs.values()].map(job => this.snapshot(job)); }
  cancel(id: string): unknown {
    const job = this.jobs.get(id);
    if (!job) throw new AgentError('CUE_NOT_FOUND', `No cue job with ID ${id}.`);
    if (job.status === 'pending' || job.status === 'running') { clearTimeout(job.timer); job.status = 'cancelled'; }
    return { job: this.snapshot(job), note: 'Pending cues are cancelled. An already dispatched OBS operation cannot be recalled.' };
  }
  close(): void {
    this.closed = true;
    for (const job of this.jobs.values()) { clearTimeout(job.timer); if (job.status === 'pending' || job.status === 'running') job.status = 'cancelled'; }
  }
}
