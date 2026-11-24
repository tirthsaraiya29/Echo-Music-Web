# Continuous Integration & Automated Test Architecture

## Overview
Echo Music Web enforces automated continuous integration (CI) across all pull requests and pushes to `main` and `feature/echo-web-integration`.

## Pipeline Execution Stages
The CI pipeline executes 4 sequential, non-bypassable quality gates:
1. **Linting (`npm run lint`)**: Executes `oxlint` with zero-warning tolerance on all TypeScript source files.
2. **Unit & Integration Tests (`npm test`)**: Executes `node --test test/*.test.ts` evaluating domain models, audio engines, synchronization, API routing, and security.
3. **Type Checking (`npm run typecheck`)**: Executes `tsc -b` with strict TypeScript configuration (`noUnusedLocals`, `noUnusedParameters`).
4. **Production Build (`npm run build`)**: Executes `tsc -b && vite build` and generates the Progressive Web App service worker.

## Local Validation
Developers and release managers can run the entire CI pipeline locally via:
```bash
npm run ci
```

## Runtime Schemas & Telemetry (`ciTypes.ts` & `ciRunner.ts`)
- `ciStepSchema`: Validates step names, commands, lifecycle status (`pending`, `running`, `success`, `failure`, `skipped`, `cancelled`), and execution durations.
- `ciPipelineResultSchema`: Enforces structured summary reporting with timestamps and step breakdown.
- `ciTelemetryMetricsSchema`: Monitors total runs triggered, completions, failures, cancellations, and step execution counts without leaking sensitive environment tokens.
