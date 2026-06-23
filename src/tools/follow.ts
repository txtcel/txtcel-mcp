import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { buildSubscribeInstruction, buildUnsubscribeInstruction } from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { resolveSeed, seedToAddress } from '../seed.js'
import { sendInstructions, explorerTx } from '../tx.js'
import { handler, jsonResult } from '../result.js'

const channelArg = z
  .string()
  .describe('Channel reference: a 64-char hex seed (rootAllocId) or a base58 thread address.')

export function registerFollowTools(server: McpServer): void {
  server.registerTool(
    'follow_channel',
    {
      title: 'Follow channel',
      description: 'Follow (subscribe to) a channel with the agent wallet.',
      inputSchema: { channel: channelArg },
    },
    handler(async ({ channel }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildSubscribeInstruction({ programId, user: payer.publicKey, seed })
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ channel: seedToAddress(seed), signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'unfollow_channel',
    {
      title: 'Unfollow channel',
      description: 'Unfollow (unsubscribe from) a channel with the agent wallet.',
      inputSchema: { channel: channelArg },
    },
    handler(async ({ channel }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildUnsubscribeInstruction({ programId, user: payer.publicKey, seed })
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ channel: seedToAddress(seed), signature, explorer: explorerTx(signature) })
    }),
  )
}
