import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  CONTENT_SLOTS,
  EXTEND_THRESHOLD,
  buildAppendContentInstruction,
  buildCloseAccountInstruction,
  buildExtendAllocTransaction,
  buildLikeContentInstruction,
  buildPrepareAllocInstruction,
  buildRequestAccessInstruction,
  buildSendMessageTransactions,
  createRootAlloc,
  deriveAccessPda,
  deriveAuthorFeePda,
  deriveContentPda,
  deriveLikesPda,
  deriveSettingsPda,
  deriveThreadPda,
  deriveTreasuryShardPda,
  loadThreadAccess,
  loadThreadNode,
  randomAuthorFeeShard,
  randomTreasuryShard,
} from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { resolveSeed, seedToAddress, seedToHex } from '../seed.js'
import { sendInstructions, sendTransactions, trySendBestEffort, explorerTx } from '../tx.js'
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
        'Post a text message to a channel as the agent wallet. Handles fees, slot selection and chunking of long messages automatically. Posting is decoupled from growing the alloc chain: after the post confirms, a best-effort page extension is fired when the tail page is filling up (its failure never affects the post).',
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

      // Decoupled, best-effort extend: after the post confirms, grow the alloc
      // chain when the tail page has crossed the SDK's extend threshold so
      // high-traffic channels keep free slots ahead of demand. This is racy and
      // optional — `buildExtendAllocTransaction` returns null when no extend is
      // due, and `trySendBestEffort` swallows any failure so it can never make
      // the post fail.
      let extendSignature: string | null = null
      try {
        const extendTx = await buildExtendAllocTransaction(connection, programId, payer.publicKey, seed)
        if (extendTx) extendSignature = await trySendBestEffort(payer, extendTx)
      } catch {
        extendSignature = null
      }

      return jsonResult({
        channel: seedToAddress(seed),
        signatures,
        explorer: signatures.map(explorerTx),
        extendSignature,
        extendExplorer: extendSignature ? explorerTx(extendSignature) : null,
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
        maxFee: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Max base fee in lamports willing to pay for the append (slippage cap). Default 100000000 (0.1 SOL).'),
      },
    },
    handler(async ({ channel, allocSeq, slot, text, maxFee }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const treasuryShardIdx = randomTreasuryShard()
      const authorFeeShardIdx = randomAuthorFeeShard()
      const cap = maxFee === undefined ? 100_000_000n : toLamports(maxFee)
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
        cap,
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
        'Manually pre-create the next alloc page (allocSeq + 1) in a channel. Extension is occupancy-gated on-chain: unless the agent wallet is the channel author (or the last extension is older than the time hatch), the tail page must hold at least EXTEND_THRESHOLD messages — this tool gathers the witness proof automatically and fails with an explanation when occupancy is too low. Racy by design: it fails with InvalidAllocSeq if the chain tail moved on.',
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('Current alloc seq to extend from.'),
      },
    },
    handler(async ({ channel, allocSeq }) => {
      const { connection, programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)

      const thread = await loadThreadNode(connection, programId, deriveThreadPda(programId, seed))
      const isAuthor = payer.publicKey.toBase58() === thread.author

      // Не-автор обязан доказать занятость хвоста witness-набором.
      let witnessSlots: number[] = []
      if (!isAuthor) {
        const pdas = Array.from({ length: CONTENT_SLOTS }, (_, slot) => deriveContentPda(programId, seed, allocSeq, slot))
        const infos = await connection.getMultipleAccountsInfo(pdas)
        const occupied = infos.reduce<number[]>((acc, info, slot) => {
          if (info !== null) acc.push(slot)
          return acc
        }, [])
        if (occupied.length < EXTEND_THRESHOLD) {
          return jsonResult({
            error: 'occupancy below extend threshold',
            occupied: occupied.length,
            required: EXTEND_THRESHOLD,
            hint: 'Only the channel author (or the daily time hatch) can extend a page this empty.',
          })
        }
        witnessSlots = occupied.slice(0, EXTEND_THRESHOLD)
      }

      const ix = buildPrepareAllocInstruction(programId, payer.publicKey, seed, allocSeq, witnessSlots)
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
        'Pay the entry fee to join a gated channel so the agent wallet can post in it. The current on-chain entry fee is used as the slippage cap unless maxFee is given.',
      inputSchema: {
        channel: channelArg,
        maxFee: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Max entry fee in lamports willing to pay (slippage cap). Defaults to the current on-chain entry fee.'),
      },
    },
    handler(async ({ channel, maxFee }) => {
      const { connection, programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      // Pin the price: without an explicit cap, cap at the fee visible now so
      // the channel admin cannot front-run a fee hike.
      const cap =
        maxFee === undefined
          ? (await loadThreadAccess(connection, programId, deriveAccessPda(programId, seed))).entryFee
          : toLamports(maxFee)
      const ix = buildRequestAccessInstruction(programId, payer.publicKey, seed, cap)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )
}
