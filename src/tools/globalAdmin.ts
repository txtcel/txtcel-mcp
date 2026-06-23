import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import {
  buildInitSettingsInstruction,
  buildSetAdminInstruction,
  buildSetFeeInstruction,
  buildSetTreasuryInstruction,
  buildSweepTreasuryInstruction,
} from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { sendInstructions, explorerTx } from '../tx.js'
import { handler, jsonResult } from '../result.js'

const feeBpsArg = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .describe('Fee in basis points (0..10000, where 10000 = 100%).')

export function registerGlobalAdminTools(server: McpServer): void {
  server.registerTool(
    'init_settings',
    {
      title: 'Init program settings',
      description:
        'Initialize the global program settings (one-time). Requires the agent wallet to be the program upgrade authority.',
      inputSchema: { treasury: z.string().describe('Treasury wallet address (base58).') },
    },
    handler(async ({ treasury }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const ix = buildInitSettingsInstruction(programId, payer.publicKey, new PublicKey(treasury))
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_treasury',
    {
      title: 'Set treasury',
      description: 'Set the treasury wallet in program settings. Requires the agent wallet to be the settings admin.',
      inputSchema: { treasury: z.string().describe('New treasury wallet address (base58).') },
    },
    handler(async ({ treasury }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const ix = buildSetTreasuryInstruction(programId, payer.publicKey, new PublicKey(treasury))
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_admin',
    {
      title: 'Set admin',
      description: 'Transfer the settings admin role to a new wallet. Requires the current admin.',
      inputSchema: { newAdmin: z.string().describe('New admin wallet address (base58).') },
    },
    handler(async ({ newAdmin }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const ix = buildSetAdminInstruction(programId, payer.publicKey, new PublicKey(newAdmin))
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  const feeCutTool = (name: string, title: string, kind: 'base' | 'authorCut' | 'entryCut' | 'likeCut', description: string) => {
    server.registerTool(
      name,
      { title, description, inputSchema: { feeBps: feeBpsArg } },
      handler(async ({ feeBps }) => {
        const { programId } = loadConfig()
        const payer = loadWallet()
        const ix = buildSetFeeInstruction(programId, payer.publicKey, kind, feeBps)
        const signature = await sendInstructions(payer, [ix])
        return jsonResult({ signature, explorer: explorerTx(signature) })
      }),
    )
  }

  feeCutTool('set_base_fee', 'Set base fee', 'base', 'Set the platform base fee (BPS of content rent). Requires settings admin.')
  feeCutTool('set_author_fee_cut', 'Set author fee cut', 'authorCut', 'Set the platform cut of author fees (BPS). Requires settings admin.')
  feeCutTool('set_entry_cut', 'Set entry cut', 'entryCut', 'Set the platform cut of entry fees (BPS). Requires settings admin.')
  feeCutTool('set_like_cut', 'Set like cut', 'likeCut', 'Set the platform cut of like fees (BPS). Requires settings admin.')

  server.registerTool(
    'sweep_treasury',
    {
      title: 'Sweep treasury',
      description:
        'Sweep accumulated platform commission from treasury shards into the treasury wallet (must equal settings.treasury).',
      inputSchema: {
        treasury: z.string().describe('Treasury wallet address (must equal settings.treasury).'),
        shardIndices: z
          .array(z.number().int().min(0).max(511))
          .min(1)
          .describe('Treasury shard indices to sweep (0..511).'),
      },
    },
    handler(async ({ treasury, shardIndices }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const ix = buildSweepTreasuryInstruction(programId, new PublicKey(treasury), shardIndices)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )
}
