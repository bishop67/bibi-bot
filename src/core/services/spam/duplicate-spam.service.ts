import { createHash } from "crypto";
import { Attachment, Message } from "discord.js";
import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import { isSpamExempt } from "@/core/services/spam/spam-exempt";
import { isStaffMember } from "@/shared/config/staff";
import {
  CHANNEL_JAIL_THRESHOLD,
  CHANNEL_SPAM_WINDOW_MS,
  CHANNEL_WARNING_THRESHOLD,
  DUPLICATE_JAIL_THRESHOLD,
  DUPLICATE_WARNING_THRESHOLD,
} from "@/shared/config/spam";
import type { UserSpamState } from "@/types";

/** Above this, an attachment is identified by metadata instead of its bytes. */
const MAX_HASH_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_FETCH_TIMEOUT_MS = 10_000;

// Duplicate detection only ever compares against the previous message, so
// state older than the spam window cannot influence a decision - it is dead
// weight holding a copy of somebody's last message. Pruning is triggered by
// size rather than on every message so the usual path stays O(1).
const STATE_TTL_MS = 15 * 60 * 1000;
const PRUNE_ABOVE = 500;

export class DuplicateSpamService {
  private static userStates = new Map<string, UserSpamState>();

  static async checkDuplicateSpam(message: Message): Promise<boolean> {
    if (message.author.bot) return false;
    if (isSpamExempt(message)) return false;

    const content = message.content.trim();
    const attachments = Array.from(message.attachments.values());

    if (!content && attachments.length === 0) return false;

    const attachmentHashes = await Promise.all(
      attachments.map((a) => this.hashAttachmentContent(a)),
    );

    const userId = message.author.id;
    const state = this.userStates.get(userId);
    const now = Date.now();
    const channelId = message.channel.id;

    const textMatches = state ? content === state.lastContent : false;
    const attachmentsMatch = state
      ? this.areAttachmentsSimilar(attachmentHashes, state.lastAttachmentHashes)
      : false;

    const isDuplicate = textMatches && attachmentsMatch;

    let count = 1;
    if (isDuplicate && state) {
      count = state.count + 1;
    }

    let recentChannels = state?.recentChannels ?? [];
    recentChannels = recentChannels.filter(
      (c) => now - c.timestamp < CHANNEL_SPAM_WINDOW_MS,
    );

    const lastChannel = recentChannels[recentChannels.length - 1];
    if (!lastChannel || lastChannel.channelId !== channelId) {
      recentChannels.push({ channelId, timestamp: now });
    }

    const uniqueChannels = new Set(recentChannels.map((c) => c.channelId)).size;

    this.userStates.set(userId, {
      count,
      lastContent: content,
      lastAttachmentHashes: attachmentHashes,
      recentChannels,
      updatedAt: now,
    });

    this.pruneStaleStates(now);

    const shouldWarnDuplicate = count >= DUPLICATE_WARNING_THRESHOLD;
    const shouldJailDuplicate = count >= DUPLICATE_JAIL_THRESHOLD;
    const shouldWarnChannelSpam = uniqueChannels >= CHANNEL_WARNING_THRESHOLD;
    const shouldJailChannelSpam = uniqueChannels >= CHANNEL_JAIL_THRESHOLD;

    if (shouldWarnDuplicate || shouldJailDuplicate) {
      return this.handleDuplicateSpam(
        message,
        userId,
        count,
        shouldJailDuplicate,
      );
    }

    if (shouldWarnChannelSpam || shouldJailChannelSpam) {
      return this.handleChannelSpam(
        message,
        userId,
        uniqueChannels,
        shouldJailChannelSpam,
      );
    }

    return false;
  }

  /**
   * Drop members not seen for a while.
   *
   * Without this the map only shrank when somebody was jailed, so every member
   * who ever posted kept an entry - each holding the full text of their last
   * message - for the lifetime of the process.
   */
  private static pruneStaleStates(now: number) {
    if (this.userStates.size <= PRUNE_ABOVE) return;

    for (const [userId, state] of this.userStates) {
      if (now - state.updatedAt > STATE_TTL_MS) this.userStates.delete(userId);
    }
  }

  private static async handleDuplicateSpam(
    message: Message,
    userId: string,
    count: number,
    shouldJail: boolean,
  ): Promise<boolean> {
    if (!message.guild) return false;

    // Warned, but a staff member's message is never removed for them.
    if (!isStaffMember(message.member)) await message.delete().catch(() => {});

    if (shouldJail) {
      const reason = `Sent ${count} duplicate messages`;

      await DeleteUserMessagesService.jailAndDeleteMessages({
        automated: true,
        jail: true,
        memberId: message.author.id,
        user: message.author,
        guild: message.guild,
        reason,
      });

      try {
        await message.author.send(
          "You have been muted. Ask a mod to unmute you.",
        );
      } catch {
        // User has DMs disabled
      }

      this.userStates.delete(userId);
    } else {
      const warningMessage = `Stop posting duplicate messages. This is warning ${count - DUPLICATE_WARNING_THRESHOLD + 1}, you will be muted at ${DUPLICATE_JAIL_THRESHOLD - DUPLICATE_WARNING_THRESHOLD + 1} warnings.`;

      try {
        await message.author.send(warningMessage);
      } catch {
        // User has DMs disabled
      }
    }

    return true;
  }

  private static async handleChannelSpam(
    message: Message,
    userId: string,
    uniqueChannels: number,
    shouldJail: boolean,
  ): Promise<boolean> {
    if (!message.guild) return false;

    // Warned, but a staff member's message is never removed for them.
    if (!isStaffMember(message.member)) await message.delete().catch(() => {});

    if (shouldJail) {
      const reason = `Posted in ${uniqueChannels} channels within 10 minutes`;

      await DeleteUserMessagesService.jailAndDeleteMessages({
        automated: true,
        jail: true,
        memberId: message.author.id,
        user: message.author,
        guild: message.guild,
        reason,
      });

      try {
        await message.author.send(
          "You have been muted. Ask a mod to unmute you.",
        );
      } catch {
        // User has DMs disabled
      }

      this.userStates.delete(userId);
    } else {
      const warningMessage = `Stop posting in multiple channels rapidly. This is warning ${uniqueChannels - CHANNEL_WARNING_THRESHOLD + 1}, you will be muted at ${CHANNEL_JAIL_THRESHOLD - CHANNEL_WARNING_THRESHOLD + 1} warnings.`;

      try {
        await message.author.send(warningMessage);
      } catch {
        // User has DMs disabled
      }
    }

    return true;
  }

  /**
   * Identify an attachment by its metadata rather than its bytes.
   *
   * Weaker - re-uploading the same file under a different name reads as
   * different - but it costs nothing and is the only sane option for a file
   * too big to hold in memory.
   */
  private static hashAttachmentMetadata(attachment: Attachment): string {
    const baseUrl = attachment.proxyURL.split("?")[0];
    return createHash("sha256")
      .update(`${attachment.size}|${attachment.name}|${baseUrl}`)
      .digest("hex")
      .slice(0, 32);
  }

  private static async hashAttachmentContent(
    attachment: Attachment,
  ): Promise<string> {
    // Anything large is identified by metadata instead of being downloaded.
    // checkDuplicateSpam hashes a message's attachments concurrently via
    // Promise.all, and Discord allows uploads far larger than the headroom on
    // a small host - so pulling the bytes in is an out-of-memory kill waiting
    // for somebody to post a video. Spam is repeated small images, which stay
    // under the threshold and keep exact content hashing.
    if (attachment.size > MAX_HASH_BYTES) {
      return this.hashAttachmentMetadata(attachment);
    }

    try {
      // An unbounded fetch can also hang the queue on a slow CDN.
      const response = await fetch(attachment.url, {
        signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("Failed to fetch");

      const buffer = await response.arrayBuffer();
      return createHash("sha256")
        .update(Buffer.from(buffer))
        .digest("hex")
        .slice(0, 32);
    } catch {
      return this.hashAttachmentMetadata(attachment);
    }
  }

  private static areAttachmentsSimilar(
    hashes1: string[],
    hashes2: string[],
  ): boolean {
    if (hashes1.length !== hashes2.length) return false;
    if (hashes1.length === 0) return true;

    const sorted1 = [...hashes1].sort();
    const sorted2 = [...hashes2].sort();

    return sorted1.every((hash, i) => hash === sorted2[i]);
  }
}
