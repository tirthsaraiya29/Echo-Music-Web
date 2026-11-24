import {
  type CiStep,
  type CiPipelineResult,
  ciPipelineResultSchema,
  recordCiMetric,
} from './ciTypes.ts'

export interface PipelineExecutionOptions {
  signal?: AbortSignal
  dryRun?: boolean
}

export class CiPipelineRunner {
  private steps: CiStep[]

  constructor(customSteps?: CiStep[]) {
    this.steps = customSteps || [
      { name: 'Lint', command: 'npm run lint', status: 'pending', durationMs: 0 },
      { name: 'Unit Tests', command: 'npm test', status: 'pending', durationMs: 0 },
      { name: 'Type Check', command: 'npm run typecheck', status: 'pending', durationMs: 0 },
      { name: 'Production Build', command: 'npm run build', status: 'pending', durationMs: 0 },
    ]
  }

  getSteps(): CiStep[] {
    return this.steps.map((s) => ({ ...s }))
  }

  async run(
    stepExecutors?: Record<string, () => Promise<void>>,
    options?: PipelineExecutionOptions,
  ): Promise<CiPipelineResult> {
    recordCiMetric('runsTriggered')
    const startTime = Date.now()
    const evaluatedSteps: CiStep[] = []
    let overallStatus: 'passed' | 'failed' | 'cancelled' = 'passed'

    for (const step of this.steps) {
      if (options?.signal?.aborted) {
        recordCiMetric('runsCancelled')
        overallStatus = 'cancelled'
        evaluatedSteps.push({
          ...step,
          status: 'cancelled',
          error: 'Pipeline aborted by signal',
        })
        break
      }

      recordCiMetric('totalStepExecutions')
      const stepStart = Date.now()

      try {
        const executor = stepExecutors?.[step.name]
        if (executor) {
          await executor()
        }
        evaluatedSteps.push({
          ...step,
          status: 'success',
          durationMs: Date.now() - stepStart,
        })
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        evaluatedSteps.push({
          ...step,
          status: 'failure',
          durationMs: Date.now() - stepStart,
          error: errorMsg,
        })
        overallStatus = 'failed'
        recordCiMetric('runsFailed')
        break
      }
    }

    if (overallStatus === 'passed') {
      recordCiMetric('runsCompleted')
    }

    const result: CiPipelineResult = {
      id: `ci-${Date.now()}`,
      timestamp: Date.now(),
      status: overallStatus,
      totalDurationMs: Date.now() - startTime,
      steps: evaluatedSteps,
    }

    return ciPipelineResultSchema.parse(result)
  }
}
