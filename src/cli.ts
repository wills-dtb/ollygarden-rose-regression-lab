import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { evaluate, markdown, type GoldenSet, type AgentRun } from './evaluator.ts';
function arg(name: string, fallback: string): string { const i = process.argv.indexOf(name); return i < 0 ? fallback : (process.argv[i+1] ?? fallback); }
const golden = JSON.parse(readFileSync(resolve(arg('--golden','fixtures/golden.json')), 'utf8')) as GoldenSet;
const candidate = JSON.parse(readFileSync(resolve(arg('--candidate','fixtures/agent-good.json')), 'utf8')) as AgentRun;
const report = evaluate(golden, candidate);
const output = resolve(arg('--output','reports/summary.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
writeFileSync(output.replace(/\.json$/,'.md'), markdown(report));
console.log(markdown(report));
process.exitCode = report.passed ? 0 : 1;
