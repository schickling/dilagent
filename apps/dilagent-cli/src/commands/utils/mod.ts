import * as Cli from '@effect/cli'
import { mcpProxyHttpToStdioCommand } from './mcp-proxy-http-to-stdio.ts'
import { printMcpSchemaCommand } from './print-mcp-schema.ts'
import { stateClearCommand } from './state-clear.ts'

export const utilsCommand = Cli.Command.make('utils', {}).pipe(
  Cli.Command.withSubcommands([mcpProxyHttpToStdioCommand, printMcpSchemaCommand, stateClearCommand]),
)
