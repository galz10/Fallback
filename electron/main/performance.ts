const startupMarks = new Map<string, number>();

export interface StartupBudgetResult {
  name: string;
  durationMs: number;
  budgetMs: number;
  ok: boolean;
}

export function markStartup(name: string): void {
  const at = performance.now();
  startupMarks.set(name, at);
  if (shouldLogPerformance() && name !== "process:start")
    console.info(`[perf] startup ${name}: ${Math.round(at - (startupMarks.get("process:start") ?? at))}ms`);
}

export function hasStartupMark(name: string): boolean {
  return startupMarks.has(name);
}

export function startupMarkMs(name: string): number | null {
  return startupMarks.get(name) ?? null;
}

export function isFirstUsableMarked(): boolean {
  return startupMarks.has("renderer:first-usable");
}

export function logStartupMeasure(name: string, start: string, end: string): void {
  if (!shouldLogPerformance()) return;
  const startAt = startupMarks.get(start);
  const endAt = startupMarks.get(end);
  if (startAt == null || endAt == null) return;
  console.info(`[perf] ${name}: ${Math.round(endAt - startAt)}ms`);
}

export function logStartupBudget(name: string, start: string, end: string, budgetMs: number): StartupBudgetResult | null {
  const startAt = startupMarks.get(start);
  const endAt = startupMarks.get(end);
  if (startAt == null || endAt == null) return null;
  const durationMs = Math.round(endAt - startAt);
  const ok = durationMs <= budgetMs;
  if (shouldLogPerformance()) {
    const method = ok ? console.info : console.warn;
    method(`[perf] startup budget ${ok ? "ok" : "miss"} ${name}: ${durationMs}ms budget=${budgetMs}ms`);
  }
  return { name, durationMs, budgetMs, ok };
}

export function logStartupSinceStart(name: string, end: string): void {
  logStartupMeasure(name, "process:start", end);
}

export function startupTimeline(): Array<{ name: string; msSinceStart: number }> {
  const startAt = startupMarks.get("process:start") ?? 0;
  return [...startupMarks.entries()]
    .map(([name, at]) => ({ name, msSinceStart: Math.round(at - startAt) }))
    .sort((a, b) => a.msSinceStart - b.msSinceStart);
}

export function logStartupTimeline(): void {
  if (!shouldLogPerformance()) return;
  const timeline = startupTimeline();
  if (timeline.length === 0) return;
  console.info(`[perf] startup timeline ${timeline.map((entry) => `${entry.name}=${entry.msSinceStart}ms`).join(" ")}`);
}

export function shouldLogPerformance(): boolean {
  return process.env.FALLBACK_PERF_SMOKE === "1" || process.env.FALLBACK_PERF_LOGS === "1";
}
