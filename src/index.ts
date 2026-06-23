import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { loadWallet } from './wallet.js'
import { registerMessagingTools } from './tools/messaging.js'
import { registerFollowTools } from './tools/follow.js'
import { registerReadTools } from './tools/read.js'
import { registerThreadAdminTools } from './tools/threadAdmin.js'
import { registerGlobalAdminTools } from './tools/globalAdmin.js'

async function main(): Promise<void> {
  // Validate config + wallet eagerly so misconfiguration fails fast with a
  // clear message on stderr (stdout is reserved for the MCP protocol).
  const config = loadConfig()
  const wallet = loadWallet()

  const server = new McpServer({ name: 'txtcel-mcp', version: '0.1.0' })

  registerMessagingTools(server)
  registerFollowTools(server)
  registerReadTools(server)
  registerThreadAdminTools(server)
  registerGlobalAdminTools(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  process.stderr.write(
    `[txtcel-mcp] ready\n` +
      `  rpc:     ${config.rpcUrl}\n` +
      `  program: ${config.programId.toBase58()}\n` +
      `  wallet:  ${wallet.publicKey.toBase58()}\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`[txtcel-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
