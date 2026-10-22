// Rose Regression Lab: independent, synthetic agent-evaluation gate.
// Node >=22.6, run with --experimental-strip-types. No dependencies or model API keys.
export type Finding = { code: string; detail?: string };
export type Span = { name: string; attributes: Record<string, string | number | boolean> };
export type GoldenCase = { id: string; description: string; expected: string[] };
export type GoldenSet = { cases: GoldenCase[]; thresholds: { min_precision: number; min_recall: number; min_stability: number; max_total_cost_usd: number; max_case_latency_ms: number } };
export type AgentResult = { case_id: string; findings: Finding[]; emitted_spans: Span[]; cost_usd: number; duration_ms: number };
export type AgentRun = { model: string; prompt_version: string; results: AgentResult[]; repeat_results: { case_id: string; findings: Finding[] }[] };
export type CaseScore = { id: string; expected: string[]; observed: string[]; true_positive: number; false_positive: number; false_negative: number; stability: number; violations: string[]; cost_usd: number; duration_ms: number };
export type Report = { passed: boolean; model: string; prompt_version: string; summary: { precision: number; recall: number; stability: number; total_cost_usd: number; max_latency_ms: number; cases: number }; cases: CaseScore[]; reasons: string[] };
const highCardinalityKeys = new Set(['user.id', 'user.email', 'session.id', 'request.id']);
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const secretPattern = /(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|(?:api[_-]?key|password|secret|authorization)\s*[:=]\s*\S+)/i;

export function inspectSpans(spans: Span[]): string[] {
  const violations: string[] = [];
  for (const [index, span] of spans.entries()) {
    const attrs = span.attributes ?? {};
    if (!attrs['service.name']) violations.push(`span ${index}: missing service.name`);
    for (const [key, raw] of Object.entries(attrs)) {
      const value = String(raw);
      if (highCardinalityKeys.has(key)) violations.push(`span ${index}: high-cardinality attribute key ${key}`);
      if (emailPattern.test(value)) violations.push(`span ${index}: potential email in ${key}`);
      if (secretPattern.test(value)) violations.push(`span ${index}: potential secret in ${key}`);
      if (key === 'http.route' && (/\/[0-9]{5,}(?:\/|$)/.test(value) || /\/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value))) violations.push(`span ${index}: untemplated route`);
    }
  }
  return violations;
}
function uniqueCodes(findings: Finding[]): string[] { return [...new Set(findings.map(f => f.code))].sort(); }
export function jaccard(a: string[], b: string[]): number {
  const aa = new Set(a), bb = new Set(b), union = new Set([...aa, ...bb]);
  if (union.size === 0) return 1;
  return [...aa].filter(v => bb.has(v)).length / union.size;
}
export function evaluate(golden: GoldenSet, run: AgentRun): Report {
  const reasons: string[] = [], scores: CaseScore[] = [];
  const resultMap = new Map(run.results.map(r => [r.case_id, r]));
  const repeatMap = new Map(run.repeat_results.map(r => [r.case_id, r]));
  if (resultMap.size !== run.results.length) reasons.push('Duplicate case IDs in primary run');
  if (repeatMap.size !== run.repeat_results.length) reasons.push('Duplicate case IDs in repeat run');
  const known = new Set(golden.cases.map(c => c.id));
  for (const id of resultMap.keys()) if (!known.has(id)) reasons.push(`Unexpected case: ${id}`);
  let tp = 0, fp = 0, fn = 0, totalCost = 0, maxLatency = 0;
  for (const item of golden.cases) {
    const actual = resultMap.get(item.id), repeat = repeatMap.get(item.id);
    if (!actual) { reasons.push(`Missing case: ${item.id}`); continue; }
    if (!repeat) reasons.push(`Missing repeat run: ${item.id}`);
    const expected = [...new Set(item.expected)].sort(), observed = uniqueCodes(actual.findings);
    const expectedSet = new Set(expected), observedSet = new Set(observed);
    const ct = observed.filter(c => expectedSet.has(c)).length;
    const cf = observed.filter(c => !expectedSet.has(c)).length;
    const cn = expected.filter(c => !observedSet.has(c)).length;
    const stability = repeat ? jaccard(observed, uniqueCodes(repeat.findings)) : 0;
    const violations = inspectSpans(actual.emitted_spans);
    if (violations.length) reasons.push(`${item.id}: unsafe proposed instrumentation (${violations.join('; ')})`);
    if (!Number.isFinite(actual.cost_usd) || actual.cost_usd < 0) reasons.push(`${item.id}: invalid cost`);
    if (!Number.isFinite(actual.duration_ms) || actual.duration_ms < 0) reasons.push(`${item.id}: invalid latency`);
    tp += ct; fp += cf; fn += cn;
    totalCost += actual.cost_usd;
    maxLatency = Math.max(maxLatency, actual.duration_ms);
    scores.push({ id: item.id, expected, observed, true_positive: ct, false_positive: cf, false_negative: cn, stability, violations, cost_usd: actual.cost_usd, duration_ms: actual.duration_ms });
  }
  const precision = tp + fp ? tp / (tp + fp) : (fn ? 0 : 1);
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const stability = scores.length ? scores.reduce((s,c) => s + c.stability, 0) / scores.length : 0;
  const t = golden.thresholds;
  if (precision < t.min_precision) reasons.push(`Precision ${precision.toFixed(3)} below ${t.min_precision}`);
  if (recall < t.min_recall) reasons.push(`Recall ${recall.toFixed(3)} below ${t.min_recall}`);
  if (stability < t.min_stability) reasons.push(`Stability ${stability.toFixed(3)} below ${t.min_stability}`);
  if (totalCost > t.max_total_cost_usd) reasons.push(`Cost $${totalCost.toFixed(4)} exceeds $${t.max_total_cost_usd}`);
  if (maxLatency > t.max_case_latency_ms) reasons.push(`Latency ${maxLatency}ms exceeds ${t.max_case_latency_ms}ms`);
  if (scores.length !== golden.cases.length) reasons.push('Incomplete golden-set coverage');
  return { passed: reasons.length === 0, model: run.model, prompt_version: run.prompt_version, summary: { precision, recall, stability, total_cost_usd: totalCost, max_latency_ms: maxLatency, cases: scores.length }, cases: scores, reasons };
}
export function markdown(report: Report): string {
  const s = report.summary;
  return `# Rose Regression Lab — ${report.passed ? 'PASS' : 'FAIL'}\n\nModel: ${report.model}; prompt: ${report.prompt_version}\n\nPrecision: ${(s.precision * 100).toFixed(1)}% | Recall: ${(s.recall * 100).toFixed(1)}% | Stability: ${(s.stability * 100).toFixed(1)}% | Cost: $${s.total_cost_usd.toFixed(4)} | Max latency: ${s.max_latency_ms}ms\n\n| Case | TP | FP | FN | Stability | Safety violations |\n|---|---:|---:|---:|---:|---:|\n${report.cases.map(c=>`| ${c.id} | ${c.true_positive} | ${c.false_positive} | ${c.false_negative} | ${(c.stability*100).toFixed(0)}% | ${c.violations.length} |`).join('\n')}\n\n${report.reasons.length ? `## Gate failures\n${report.reasons.map(r=>`- ${r}`).join('\n')}\n` : 'No gate failures.\n'}`;
}
