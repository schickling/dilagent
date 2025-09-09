import { Schema } from 'effect'
import { HypothesisId } from './common.ts'

/**
 * SYNCHRONIZATION NOTE: This schema must remain semantically aligned with the report.md
 * template structure defined in hypothesis-worker.ts. When updating this schema, ensure
 * the corresponding report template contains equivalent information sections, particularly:
 * - solutionProposals ↔ Solution Proposals section
 * - experimentHierarchy ↔ Experiment Hierarchy section
 * - evidence ↔ Evidence Repository section
 * - confidenceLevel ↔ Conclusion section
 * - riskAssessment ↔ Risk Assessment section
 * - investigationTimeline ↔ Investigation Timeline section
 * - codeContext ↔ Code Context & Analysis subsection in Evidence Repository
 * - comparativeAnalysis ↔ Comparative Analysis section
 * - debuggingArtifacts ↔ Debugging Artifacts subsection in Evidence Repository
 * - statisticalAnalysis ↔ Statistical Analysis subsection in Evidence Repository
 */

export const HypothesisInput = Schema.TaggedStruct('HypothesisInput', {
  hypothesisId: HypothesisId,
  problemTitle: Schema.String.annotations({ description: 'A short title of the problem hypothesis' }),
  problemDescription: Schema.String.annotations({ description: 'A short description of the problem hypothesis' }),
  files: Schema.Array(Schema.String).annotations({ description: 'The files that are relevant to the problem' }),
  problemDetails: Schema.String.annotations({
    description: 'A detailed multi-paragraph description of the problem hypothesis with all relevant information',
  }),
  reproductionSteps: Schema.Array(
    Schema.String.annotations({
      description:
        'A detailed description of the reproduction steps to test the hypothesis. Be very specific (e.g. file paths, command line arguments, function calls, etc.).',
    }),
  ),
  observedBehavior: Schema.String.annotations({
    description: 'A detailed description of the observed behavior of the problem including errors, logs, etc.',
  }),
}).annotations({ title: 'HypothesisInput' })

export type HypothesisInput = typeof HypothesisInput.Type

export const GenerateHypothesesInputResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    hypotheses: Schema.Array(HypothesisInput),
  }),
  Schema.TaggedStruct('Error', {
    error: Schema.String,
  }),
).annotations({ title: 'GenerateHypothesesInputResult' })

export const HypothesisPhase = Schema.Literal('DESIGNING', 'TESTING', 'DIAGNOSING', 'COUNTER_TESTING').annotations({
  title: 'HypothesisPhase',
  description: 'Current phase in the hypothesis testing loop',
})

export type HypothesisPhase = typeof HypothesisPhase.Type

export const HypothesisResult = Schema.Union(
  Schema.TaggedStruct('Proven', {
    hypothesisId: HypothesisId,
    findings: Schema.String.annotations({
      description: 'Summary of root causes and findings from the diagnosis',
    }),
    rootCauses: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.Literal('tooling', 'algorithmic', 'configuration', 'environmental'),
          description: Schema.String,
        }),
      ),
    ),
    solutionProposals: Schema.optional(
      Schema.Struct({
        primarySolution: Schema.Struct({
          name: Schema.String,
          rootCauseType: Schema.Literal('tooling', 'algorithmic', 'configuration', 'environmental'),
          description: Schema.String.annotations({
            description: 'Detailed explanation of the root cause',
          }),
          proposedFix: Schema.String.annotations({
            description: 'Step-by-step implementation guide',
          }),
          codeChanges: Schema.optional(
            Schema.String.annotations({
              description: 'Specific code changes with before/after examples',
            }),
          ),
          configurationChanges: Schema.optional(
            Schema.String.annotations({
              description: 'Configuration file modifications needed',
            }),
          ),
          implementationRisks: Schema.optional(
            Schema.String.annotations({
              description:
                'Brief implementation-specific risks (detailed risk assessment is provided at the top level)',
            }),
          ),
          verificationSteps: Schema.Array(Schema.String).annotations({
            description: 'Steps to confirm the fix works',
          }),
        }),
        alternativeSolutions: Schema.optional(
          Schema.Array(
            Schema.Struct({
              name: Schema.String,
              approach: Schema.String.annotations({
                description: 'Different way to solve the same root cause',
              }),
              pros: Schema.Array(Schema.String),
              cons: Schema.Array(Schema.String),
              implementation: Schema.String.annotations({
                description: 'High-level implementation steps',
              }),
            }),
          ),
        ),
        implementationRecommendations: Schema.optional(
          Schema.Struct({
            priority: Schema.Literal('High', 'Medium', 'Low'),
            effortEstimate: Schema.String.annotations({
              description: 'Time/complexity estimate',
            }),
            dependencies: Schema.optional(Schema.Array(Schema.String)),
            testingStrategy: Schema.String,
            rollbackPlan: Schema.String,
          }),
        ),
      }),
    ),
    experimentHierarchy: Schema.optional(
      Schema.Array(
        Schema.Struct({
          experimentId: Schema.String.annotations({
            description: 'Experiment ID (e.g., E01, E02)',
          }),
          name: Schema.String,
          hypothesis: Schema.String.annotations({
            description: 'Specific aspect being tested',
          }),
          result: Schema.String,
          diagnosis: Schema.Literal('Inconclusive', 'Failed', 'Confirms Hypothesis'),
          counterExperiments: Schema.optional(
            Schema.Array(
              Schema.Struct({
                counterExperimentId: Schema.String.annotations({
                  description: 'Counter-experiment ID (e.g., E01:C01)',
                }),
                name: Schema.String,
                purpose: Schema.String.annotations({
                  description: 'How this could invalidate the main experiment',
                }),
                result: Schema.String,
                status: Schema.Literal('Inconclusive', 'Passed', 'Invalidated Main Experiment'),
                impact: Schema.String.annotations({
                  description: 'How this affects main experiment conclusions',
                }),
              }),
            ),
          ),
        }),
      ),
    ),
    nextSteps: Schema.optional(Schema.Array(Schema.String)),
    evidence: Schema.optional(
      Schema.Struct({
        reproduction: Schema.optional(
          Schema.Struct({
            minimalReproduction: Schema.optional(Schema.String),
            environment: Schema.optional(Schema.String),
            consistency: Schema.optional(Schema.String),
          }),
        ),
        measurementData: Schema.optional(
          Schema.Struct({
            performanceMetrics: Schema.optional(Schema.String),
            resourceUsage: Schema.optional(Schema.String),
            timingData: Schema.optional(Schema.String),
          }),
        ),
        errorAnalysis: Schema.optional(
          Schema.Struct({
            errorMessages: Schema.optional(Schema.String),
            stackTraces: Schema.optional(Schema.String),
            systemLogs: Schema.optional(Schema.String),
          }),
        ),
        testResults: Schema.optional(
          Schema.Struct({
            testOutputs: Schema.optional(Schema.String),
            manualVerification: Schema.optional(Schema.String),
            regressionTests: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
    confidenceLevel: Schema.optional(
      Schema.Struct({
        level: Schema.Literal('High', 'Medium', 'Low'),
        justification: Schema.String,
        counterExperimentsPassed: Schema.optional(
          Schema.String.annotations({
            description: 'Format: X/Y passed',
          }),
        ),
        evidenceQuality: Schema.optional(Schema.Literal('Strong', 'Moderate', 'Weak')),
        reproductionReliability: Schema.optional(Schema.Literal('Consistent', 'Intermittent', 'Unreliable')),
      }),
    ),
    investigationTimeline: Schema.optional(
      Schema.Struct({
        investigationStart: Schema.String.annotations({ description: 'Timestamp when investigation began' }),
        totalTimeInvested: Schema.String.annotations({ description: 'Total duration of investigation' }),
        phasesCompleted: Schema.String.annotations({ description: 'Phases completed (e.g., "3/4")' }),
        keyDecisionPoints: Schema.Array(
          Schema.Struct({
            timestamp: Schema.String,
            decision: Schema.String,
            alternatives: Schema.Array(Schema.String),
            timeSpent: Schema.String,
            outcome: Schema.String,
          }),
        ),
        efficiencyMetrics: Schema.optional(
          Schema.Struct({
            experimentsPerHour: Schema.optional(Schema.String),
            timeToFirstFinding: Schema.optional(Schema.String),
            falseLeadRatio: Schema.optional(Schema.String),
            pathConvergence: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
    codeContext: Schema.optional(
      Schema.Struct({
        problematicLocations: Schema.Array(
          Schema.Struct({
            file: Schema.String,
            lines: Schema.String,
            issue: Schema.String,
            codeSnippet: Schema.String,
            keyProblem: Schema.String,
          }),
        ),
        relatedDependencies: Schema.Array(
          Schema.Struct({
            file: Schema.String,
            description: Schema.String,
          }),
        ),
        solutionDiffs: Schema.Array(
          Schema.Struct({
            file: Schema.String,
            beforeCode: Schema.String,
            afterCode: Schema.String,
            explanation: Schema.String,
          }),
        ),
        callStackAnalysis: Schema.optional(Schema.String),
        dataFlowTracing: Schema.optional(Schema.String),
      }),
    ),
    comparativeAnalysis: Schema.optional(
      Schema.Struct({
        similarIssues: Schema.Array(
          Schema.Struct({
            reference: Schema.String,
            description: Schema.String,
            relationship: Schema.String,
          }),
        ),
        commonPatterns: Schema.Array(Schema.String),
        uniqueAspects: Schema.Array(Schema.String),
        knowledgeBaseReferences: Schema.Array(
          Schema.Struct({
            type: Schema.Literal('documentation', 'investigation', 'community'),
            link: Schema.String,
            relevance: Schema.String,
          }),
        ),
        antiPatterns: Schema.Array(
          Schema.Struct({
            pattern: Schema.String,
            whyIneffective: Schema.String,
          }),
        ),
      }),
    ),
    debuggingArtifacts: Schema.optional(
      Schema.Struct({
        debugLogs: Schema.Array(
          Schema.Struct({
            filename: Schema.String,
            description: Schema.String,
            verbosityLevel: Schema.String,
          }),
        ),
        performanceProfiles: Schema.Array(
          Schema.Struct({
            filename: Schema.String,
            type: Schema.Literal('cpu', 'memory', 'network'),
            description: Schema.String,
            duration: Schema.String,
          }),
        ),
        systemArtifacts: Schema.Array(
          Schema.Struct({
            filename: Schema.String,
            type: Schema.String,
            description: Schema.String,
          }),
        ),
        reproducibilityChecksums: Schema.optional(
          Schema.Struct({
            environmentHash: Schema.String,
            codeVersion: Schema.String,
            dataChecksums: Schema.Array(Schema.String),
          }),
        ),
        interactiveDebuggingNotes: Schema.optional(Schema.String),
      }),
    ),
    statisticalAnalysis: Schema.optional(
      Schema.Struct({
        reproductionStatistics: Schema.Struct({
          successRate: Schema.String.annotations({ description: 'Format: X/Y attempts (Z%)' }),
          meanTimeToReproduce: Schema.optional(Schema.String),
          reproductionConditions: Schema.Array(Schema.String),
        }),
        environmentalCorrelations: Schema.Array(
          Schema.Struct({
            factor: Schema.String.annotations({ description: 'e.g., OS, hardware, software version' }),
            correlation: Schema.String,
          }),
        ),
        timingPatterns: Schema.optional(
          Schema.Struct({
            timeOfDayCorrelation: Schema.optional(Schema.String),
            durationAnalysis: Schema.optional(Schema.String),
            frequencyPattern: Schema.optional(Schema.String),
          }),
        ),
        performanceImpact: Schema.optional(
          Schema.Struct({
            latencyDegradation: Schema.optional(Schema.String),
            throughputImpact: Schema.optional(Schema.String),
            resourceUtilization: Schema.optional(Schema.String),
          }),
        ),
        confidenceIntervals: Schema.optional(
          Schema.Struct({
            reproductionRate: Schema.optional(Schema.String),
            performanceImpact: Schema.optional(Schema.String),
            fixEffectiveness: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
    riskAssessment: Schema.optional(
      Schema.Struct({
        changeImpact: Schema.String,
        potentialSideEffects: Schema.Array(Schema.String),
        mitigationStrategies: Schema.Array(Schema.String),
        monitoringRequirements: Schema.Array(Schema.String),
      }),
    ),
  }).annotations({ title: 'Proven' }),
  Schema.TaggedStruct('Disproven', {
    hypothesisId: HypothesisId,
    reason: Schema.String.annotations({
      description: 'A detailed description of the reason the experiment was disproven',
    }),
    evidence: Schema.String.annotations({
      description: 'Clear evidence backing up why the experiment has disproven the root cause hypothesis',
    }),
    newhypothesisIdeas: Schema.Array(HypothesisInput.omit('hypothesisId')).annotations({
      description: 'Based on learnings from the current experiment, a list of new experiment ideas to try.',
    }),
  }).annotations({ title: 'Disproven' }),
  Schema.TaggedStruct('Inconclusive', {
    hypothesisId: HypothesisId,
    attemptedExperiments: Schema.Array(Schema.String).annotations({
      description: 'List of experiments that were attempted',
    }),
    intractableReason: Schema.String.annotations({
      description: 'Explanation of why this hypothesis cannot be definitively proven or disproven',
    }),
  }).annotations({ title: 'Inconclusive' }),
).annotations({
  title: 'HypothesisResult',
  description: 'The final result of a hypothesis (use Inconclusive sparingly as last resort)',
})

export const HypothesisStatusUpdate = Schema.TaggedStruct('HypothesisStatusUpdate', {
  hypothesisId: HypothesisId,
  phase: HypothesisPhase,
  experimentId: Schema.optional(
    Schema.String.annotations({
      description: 'Current experiment being worked on (e.g., E01, E02)',
    }),
  ),
  counterExperimentId: Schema.optional(
    Schema.String.annotations({
      description: 'Current counter-experiment being worked on (e.g., E01:C01)',
    }),
  ),
  status: Schema.String.annotations({
    description: 'Detailed status message about current progress',
  }),
  evidence: Schema.optional(
    Schema.String.annotations({
      description: 'Any evidence collected so far during this phase',
    }),
  ),
  experimentResult: Schema.optional(
    Schema.Literal('Inconclusive', 'Failed', 'Confirms Hypothesis').annotations({
      description: 'Result of the current experiment if completed',
    }),
  ),
  counterExperimentResult: Schema.optional(
    Schema.Literal('Inconclusive', 'Passed', 'Invalidated Main Experiment').annotations({
      description: 'Result of the current counter-experiment if completed',
    }),
  ),
}).annotations({
  title: 'HypothesisStatusUpdate',
  description: 'IMPORTANT: Keep this schema in sync with the report.md template structure in hypothesis-worker.ts',
})

export type HypothesisStatusUpdate = typeof HypothesisStatusUpdate.Type
