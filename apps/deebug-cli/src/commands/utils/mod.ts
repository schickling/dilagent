import * as Cli from '@effect/cli'
import { mcpProxyHttpToStdioCommand } from './mcp-proxy-http-to-stdio.ts'

export const utilsCommand = Cli.Command.make('utils', {}).pipe(
  Cli.Command.withSubcommands([mcpProxyHttpToStdioCommand]),
)