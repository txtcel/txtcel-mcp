import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import {
  CONTENT_SLOTS,
  TAG_CONTENT,
  decodeContent,
  deriveAccessPda,
  deriveContentPda,
  deriveLikesPda,
  deriveThreadPda,
  loadAccessEntries,
  loadAllocLikes,
  loadContentNode,
  loadFollowRegistry,
  loadFollowerCount,
  loadProgramSettings,
  loadThreadAccess,
  loadThreadNode,
  loadThreadNodesBatched,
} from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { resolveSeed, seedToAddress, seedToHex } from '../seed.js'
import { lamportsToSol } from '../tx.js'
import { handler, jsonResult } from '../result.js'

const channelArg = z
  .string()
  .describe('Channel reference: a 64-char hex seed (rootAllocId) or a base58 thread address.')

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'get_wallet',
    {
      title: 'Get agent wallet',
      description:
        'Return the agent wallet address and its SOL balance on the configured cluster. Fund this address to let the agent pay rent + fees.',
      inputSchema: {},
    },
    handler(async () => {
      const { connection, rpcUrl } = loadConfig()
      const payer = loadWallet()
      const lamports = await connection.getBalance(payer.publicKey, 'confirmed')
      return jsonResult({
        address: payer.publicKey.toBase58(),
        balanceSol: lamportsToSol(lamports),
        balanceLamports: lamports,
        rpcUrl,
      })
    }),
  )

  server.registerTool(
    'get_channel',
    {
      title: 'Get channel info',
      description: 'Fetch a channel\'s metadata (author, title, fees) and live follower count.',
      inputSchema: { channel: channelArg },
    },
    handler(async ({ channel }) => {
      const { connection, programId } = loadConfig()
      const seed = resolveSeed(channel)
      const thread = await loadThreadNode(connection, programId, deriveThreadPda(programId, seed))
      const followers = await loadFollowerCount(connection, programId, seed)
      return jsonResult({
        seed: seedToHex(seed),
        address: seedToAddress(seed),
        title: thread.title,
        author: thread.author,
        messageFee: thread.messageFee,
        likeFee: thread.likeFee,
        lastAllocSeq: thread.lastAllocSeq,
        allocCount: thread.allocCount,
        followers,
      })
    }),
  )

  server.registerTool(
    'get_message',
    {
      title: 'Get message',
      description: 'Fetch a single message (content node) by allocSeq + slot.',
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int(),
        slot: z.number().int(),
      },
    },
    handler(async ({ channel, allocSeq, slot }) => {
      const { connection, programId } = loadConfig()
      const seed = resolveSeed(channel)
      const content = await loadContentNode(
        connection,
        programId,
        deriveContentPda(programId, seed, allocSeq, slot),
      )
      return jsonResult(content)
    }),
  )

  server.registerTool(
    'read_messages',
    {
      title: 'Read messages',
      description:
        'Read recent messages from a channel (most recent first). Walks the alloc pages and decodes content slots.',
      inputSchema: {
        channel: channelArg,
        limit: z.number().int().min(1).max(200).optional().describe('Max messages to return. Default 30.'),
      },
    },
    handler(async ({ channel, limit }) => {
      const { connection, programId } = loadConfig()
      const seed = resolveSeed(channel)
      const max = limit ?? 30
      const thread = await loadThreadNode(connection, programId, deriveThreadPda(programId, seed))

      const messages: Array<Record<string, unknown>> = []
      for (let allocSeq = thread.lastAllocSeq; allocSeq >= 0 && messages.length < max; allocSeq--) {
        const pdas: PublicKey[] = Array.from({ length: CONTENT_SLOTS }, (_, slot) =>
          deriveContentPda(programId, seed, allocSeq, slot),
        )
        const infos = await connection.getMultipleAccountsInfo(pdas, 'confirmed')
        for (let slot = CONTENT_SLOTS - 1; slot >= 0 && messages.length < max; slot--) {
          const info = infos[slot]
          if (!info || info.data.length === 0 || info.data[0] !== TAG_CONTENT) continue
          const decoded = decodeContent(pdas[slot].toBase58(), info.data)
          messages.push({
            allocSeq: decoded.allocSeq,
            slot: decoded.slot,
            author: decoded.author,
            text: decoded.text,
            createdAt: decoded.createdAt,
            replyAllocSeq: decoded.replyAllocSeq,
            replySlot: decoded.replySlot,
          })
        }
      }

      return jsonResult({ channel: seedToAddress(seed), count: messages.length, messages })
    }),
  )

  server.registerTool(
    'list_follows',
    {
      title: 'List follows',
      description: "List the channels the agent wallet follows, with their titles.",
      inputSchema: {},
    },
    handler(async () => {
      const { connection, programId } = loadConfig()
      const payer = loadWallet()
      const registry = await loadFollowRegistry(connection, programId, payer.publicKey)
      if (!registry || registry.channels.length === 0) {
        return jsonResult({ owner: payer.publicKey.toBase58(), channels: [] })
      }
      const keys = registry.channels.map((c) => new PublicKey(c))
      const meta = await loadThreadNodesBatched(connection, programId, keys)
      const channels = registry.channels.map((address) => ({
        address,
        title: meta.get(address)?.title ?? null,
      }))
      return jsonResult({ owner: payer.publicKey.toBase58(), count: channels.length, channels })
    }),
  )

  server.registerTool(
    'get_settings',
    {
      title: 'Get program settings',
      description: 'Fetch the global program settings (admin, treasury, fee BPS).',
      inputSchema: {},
    },
    handler(async () => {
      const { connection, programId } = loadConfig()
      const settings = await loadProgramSettings(connection, programId)
      return jsonResult(settings ?? { initialized: false })
    }),
  )

  server.registerTool(
    'get_access',
    {
      title: 'Get channel access',
      description:
        'Fetch a channel\'s access config (gating enabled, entry fee) and its whitelist / blacklist / fee-exempt lists.',
      inputSchema: { channel: channelArg },
    },
    handler(async ({ channel }) => {
      const { connection, programId } = loadConfig()
      const seed = resolveSeed(channel)
      let access: unknown = { initialized: false }
      try {
        access = await loadThreadAccess(connection, programId, deriveAccessPda(programId, seed))
      } catch {
        // access not initialized yet
      }
      const entries = await loadAccessEntries(connection, programId, seed)
      return jsonResult({ channel: seedToAddress(seed), access, entries })
    }),
  )

  server.registerTool(
    'get_likes',
    {
      title: 'Get likes',
      description: 'Fetch the per-slot like counts for an alloc page in a channel.',
      inputSchema: {
        channel: channelArg,
        allocSeq: z.number().int().describe('Alloc seq to read like counts for.'),
      },
    },
    handler(async ({ channel, allocSeq }) => {
      const { connection, programId } = loadConfig()
      const seed = resolveSeed(channel)
      const likes = await loadAllocLikes(
        connection,
        programId,
        deriveLikesPda(programId, seed, allocSeq),
      )
      return jsonResult(likes ?? { allocSeq, counts: [] })
    }),
  )
}
