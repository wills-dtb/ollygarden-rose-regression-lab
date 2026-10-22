# Rose Regression Lab — a synthetic agent-eval CI gate

**Independent demonstration, not affiliated with OllyGarden.** Built as a narrowly scoped engineering artifact for a prospective conversation with the team behind **Rose**, OllyGarden's AI OpenTelemetry engineer. No private code, APIs, model keys, customer data or real telemetry are used.

## Company-specific problem observed

OllyGarden's 9 October 2026 MVI announcement describes an AI agent that creates and improves instrumentation at the source. Its live AI Software Engineer specification calls for **golden-set evals, repeatable findings, reliable agent runs and cost measurement**. Its published customer case study describes a real log-to-metric change that accidentally included email addresses in route labels. That combination suggests a practical question: **how can an instrumentation agent change prompts or models without quietly reducing issue detection, increasing non-determinism, introducing sensitive telemetry or exceeding its budget?**

Sources:
- https://ollygarden.com/resources/press-releases/ollygarden-raises-4m-launches-minimum-viable-instrumentation
- https://ollygarden.com/careers/ai-software-engineer
- https://ollygarden.com/resources/case-studies/b2b-saas-cuts-logs-and-metrics-at-the-source

## What it does

This is an **evaluation harness for a simulated agent**, not a telemetry collector or a competing instrumentation product. It consumes a versioned golden set and synthetic agent-run outputs, then gates a proposed release on:

1. **Finding quality:** micro precision and recall against golden finding codes.
2. **Stability:** Jaccard agreement between two runs for each case (empty/empty = stable).
3. **Safety:** reject emitted instrumentation containing email addresses, obvious tokens, identity keys likely to explode cardinality, missing service names, or obvious untemplated numeric routes.
4. **Operational budgets:** aggregate estimated model cost and per-case latency.
5. **Coverage:** fail on missing or duplicate cases, unexpected IDs or missing repeats.

Outputs a machine-readable JSON report and a Markdown review artifact. Exit code **0** means all gates passed; **1** means at least one gate failed.

## Architecture

```
versioned golden set --\
                       --> evaluator.ts --> quality/safety/stability/cost gate --> JSON + Markdown --> CI exit code
synthetic agent run ----/
        | primary findings + proposed spans + cost/latency + repeat findings
```

Pure TypeScript with built-in Node.js runtime/test APIs. No runtime dependencies, no LLM calls, no cloud resources. The fixtures simulate outputs that a real agent-runner would emit. The evaluator never executes generated code.

## How to run

Requires **Node.js 22.6+**. Run from repository root:

```bash
npm test
npm run eval
npm run eval:regressed # expected nonzero exit; intentionally demonstrates the gate
```

The safe fixture passes and the intentionally regressed fixture fails. Read `reports/summary.json`, `reports/summary.md`, `reports/regressed.json` and `reports/regressed.md`. A GitHub Actions workflow runs the tests and passing baseline gate on push/PR.

To evaluate another candidate: `node --experimental-strip-types src/cli.ts --candidate path/to/run.json --output reports/candidate.json`.

## Assumptions and tradeoffs

- Finding codes are already normalised by the agent adapter; the harness does not judge free-text explanations.
- Golden labels are curated by humans and may be incomplete. A high score does not establish correctness in production.
- Stability uses a two-run Jaccard score; real LLM systems require repeated runs, confidence intervals and stratification by language and repo size.
- Regex safety checks are intentionally conservative and incomplete. They demonstrate fail-closed release policy, **not** a privacy guarantee. False positives are possible.
- Cost and latency are supplied by the fixture, not independently measured; production would need trustworthy instrumentation and provider usage records.
- Micro averages can hide severe regressions in small cohorts; a production gate should include per-class floors and critical-severity weights.
- The tool deliberately evaluates synthetic *outcomes* rather than patch ASTs or runtime OTel SDK semantics.

## Deliberately left out (2–3-hour build limit)

Real Rose integration; model/provider SDKs; repo cloning; sandboxed patch application; executing Go/Java/Kotlin/TypeScript/.NET projects; OpenTelemetry collector; authentication; persistence; dashboards; live billing; GitLab/GitHub APIs; production policy language; secret scanners; and human review UI.

## What production would need

- A stable schema contract and adapters to Rose run logs, agent versions, GitLab/GitHub events and provider usage accounting.
- Curated, privacy-safe golden repositories for multiple languages and OTel SDK versions, with expected patch semantics.
- Hermetic ephemeral sandboxes that compile, run and test patches and compare actual trace/metric/log output against expected semantic conventions.
- Safety checks for secret/PII exfiltration, telemetry cardinality, service naming, span propagation and performance overhead.
- Multi-seed evaluation, flaky-case tracking, significance tests, severity-weighted thresholds and change attribution.
- Persistent evaluation history, immutable provenance, audit trails, reviewer overrides and rollout/canary integration.
- Metrics on per-customer delivery burden, failed agent retries, p95 latency and dollars per accepted fix.

## Why this is a leadership artifact

The interesting decision isn't the regex. It's the **release contract**: a prompt change should be treated like a production code change, with explicit quality, safety, reproducibility and unit-economics gates. A small team can adopt this pattern before its agent estate grows. This is a proposal to discuss, not a claim that OllyGarden lacks such controls.
