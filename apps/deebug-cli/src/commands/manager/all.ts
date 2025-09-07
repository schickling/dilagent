import * as Cli from '@effect/cli'
import { Effect } from 'effect'
import { generateHypothesesCommand } from './generate-hypotheses.ts'
import { reproCommand } from './repro.ts'
import { runHypothesisWorkersCommand } from './run-hypotheses.ts'
import {
  contextDirectoryOption,
  countOption,
  cwdOption,
  flakyOption,
  llmOption,
  portOption,
  promptOption,
  replOption,
  workingDirectoryOption,
} from './shared.ts'

export const allCommand = Cli.Command.make(
  'all',
  {
    contextDirectory: contextDirectoryOption,
    workingDirectory: workingDirectoryOption,
    prompt: promptOption,
    count: countOption,
    llm: llmOption,
    port: portOption,
    repl: replOption,
    cwd: cwdOption,
    flaky: flakyOption,
  },
  (options) =>
    Effect.gen(function* () {
      // First run reproduction
      yield* reproCommand.handler({
        contextDirectory: options.contextDirectory,
        workingDirectory: options.workingDirectory,
        prompt: options.prompt,
        llm: options.llm,
        flaky: options.flaky,
        cwd: options.cwd,
      })

      // Then run generate-hypotheses
      yield* generateHypothesesCommand.handler({
        contextDirectory: options.contextDirectory,
        workingDirectory: options.workingDirectory,
        prompt: options.prompt,
        count: options.count,
        llm: options.llm,
        cwd: options.cwd,
      })

      // Finally run run-hypotheses
      yield* runHypothesisWorkersCommand.handler({
        workingDirectory: options.workingDirectory,
        port: options.port,
        llm: options.llm,
        repl: options.repl,
        cwd: options.cwd,
      })
    }),
)
