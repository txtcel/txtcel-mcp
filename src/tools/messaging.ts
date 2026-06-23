import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  buildAppendContentInstruction,
  buildCloseAccountInstruction,
  buildLikeContentInstruction,
  buildPrepareAllocInstruction,
  buildRequestAccessInstruction,
  buildSendMessageTransactions,
  createRootAlloc,
  deriveAuthorFeePda,
  deriveContentPda,
  deriveLikesPda,
  deriveSettingsPda,
  deriveThreadPda,
  deriveTreasuryShardPda,
  randomAuthorFeeShard,
  randomTreasuryShard,
} from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { resolveSeed, seedToAddress, seedToHex } from '../seed.js'
import { sendInstructions, sendTransactions, explorerTx } from '../tx.js'
import { handler, jsonResult, toLamports } from '../result.js'

const channelArg = z
  .string()
  .describe('Channel reference: a 64-char hex seed (rootAllocId) or a base58 thread address.')

export function registerMessagingTools(server: McpServer): void {
  server.registerTool(
    'create_channel',
    {
      title: 'Create channel',
      description:
        'Create a new Txtcel channel (thread) authored by the agent wallet. Returns the channel seed (hex) and address used to post messages.',
      inputSchema: {
        title: z.string().max(64).describe('Channel title (max 64 bytes UTF-8).'),
        messageFee: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Optional per-message fee in lamports that non-authors pay to post. Default 0.'),
      },
    },
    handler(async ({ title, messageFee }) => {
      const { connection, programId } = loadConfig()
      const payer = loadWallet()
      const fee = messageFee === undefined ? 0n : toLamports(messageFee)
      const res = await createRootAlloc(connection, programId.toBase58(), payer, fee, title)
      return jsonResult({
        title,
        seed: seedToHex(res.seed),
        address: res.threadPda,
        signature: res.signature,
        explorer: explorerTx(res.signature),
      })
    }),
  )

  server.registerTool(
    'send_message',
    {
      title: 'Send message',
      description:
        'Post a text message to a channel as the agent wallet. Handles fees, slot selection and chunking of long messages automatically.',
      inputSchema: {
        channel: channelArg,
        text: z.string().min(1).describe('Message text (UTF-8, up to 8192 bytes).'),
        replyToAllocSeq: z
          .number()
          .int()
          .optional()
          .describe('Optional: allocSeq of the message being replied to.'),
        replyToSlot: z
          .number()
          .int()
          .optional()
          .describe('Optional: slot of the message being replied to.'),
      },
    },
    handler(async ({ channel, text, replyToAllocSeq, replyToSlot }) => {
      const { connection, programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const replyTo =
        replyToAllocSeq !== undefined && replyToSlot !== undefined
          ? { allocSeq: replyToAllocSeq, slot: replyToSlot }
          : null
      const txs = await buildSendMessageTransactions(
        connection,
        programId,
        payer.publicKey,
        seed,
        text,
        replyTo,
      )
      const signatures = await sendTransactions(payer, txs)
      return jsonResult({
        channel: seedToAddress(seed),
        signatures,
        explorer: signatures.map(explorerTx),
      })
    }),
  )

  server.registerTool(
    'append_to_message',
    {
      title: 'Append to message',
      description:
        "Append more text to one of the agent's own recent messages (must be within the on-chain append window). Identify the message by allocSeq + slot.",
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('allocSeq of the target message.'),
        slot: z.number().int().describe('slot of the target message.'),
        text: z.string().min(1).describe('Text chunk to append.'),
      },
    },
    handler(async ({ channel, allocSeq, slot, text }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const treasuryShardIdx = randomTreasuryShard()
      const authorFeeShardIdx = randomAuthorFeeShard()
      const ix = buildAppendContentInstruction(
        programId,
        payer.publicKey,
        deriveContentPda(programId, seed, allocSeq, slot),
        deriveThreadPda(programId, seed),
        deriveSettingsPda(programId),
        deriveTreasuryShardPda(programId, treasuryShardIdx),
        deriveAuthorFeePda(programId, seed, authorFeeShardIdx),
        new TextEncoder().encode(text),
        treasuryShardIdx,
        authorFeeShardIdx,
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'prepare_alloc',
    {
      title: 'Prepare alloc',
      description:
        'Pre-create the next alloc page in a channel so there are free slots ahead of demand. Mostly useful for high-traffic channels.',
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('Current alloc seq to extend from.'),
      },
    },
    handler(async ({ channel, allocSeq }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildPrepareAllocInstruction(programId, payer.publicKey, seed, allocSeq)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'like_message',
    {
      title: 'Like message',
      description: 'Like a message in a channel (pays the like fee, if any).',
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('allocSeq of the message to like.'),
        slot: z.number().int().describe('slot of the message to like.'),
        maxFee: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Max fee in lamports willing to pay (slippage cap). Default 100000000 (0.1 SOL).'),
      },
    },
    handler(async ({ channel, allocSeq, slot, maxFee }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const cap = maxFee === undefined ? 100_000_000n : toLamports(maxFee)
      const ix = buildLikeContentInstruction(programId, payer.publicKey, seed, allocSeq, slot, cap)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'close_message',
    {
      title: 'Close (delete) message',
      description:
        "Delete one of the agent's own messages and reclaim its rent. Also resets the slot's like counter.",
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('allocSeq of the message to delete.'),
        slot: z.number().int().describe('slot of the message to delete.'),
      },
    },
    handler(async ({ channel, allocSeq, slot }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildCloseAccountInstruction(
        programId,
        payer.publicKey,
        deriveContentPda(programId, seed, allocSeq, slot),
        deriveLikesPda(programId, seed, allocSeq),
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'request_access',
    {
      title: 'Request channel access',
      description:
        'Pay the entry fee to join a gated channel so the agent wallet can post in it.',
      inputSchema: { channel: channelArg },
    },
    handler(async ({ channel }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildRequestAccessInstruction(programId, payer.publicKey, seed)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )
}
