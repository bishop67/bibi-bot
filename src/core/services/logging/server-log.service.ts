import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import { SERVER_LOG_CHANNELS } from "@/shared/config/channels";
import type { APIEmbed, Guild, Message, PartialMessage, TextChannel } from "discord.js";

/** Discord rejects embed descriptions past 4096; leave room for the labels. */
const MAX_CONTENT = 900;

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT) return content;
  return `${content.slice(0, MAX_CONTENT)}… *(truncated)*`;
}

/**
 * Quote a message body for an embed.
 *
 * Content is wrapped in a code fence so mentions, markdown and invite links in
 * the original cannot render or ping from inside the log itself.
 */
function quote(content: string | null | undefined): string {
  if (!content) return "*(no text content)*";
  return `\`\`\`\n${truncate(content).replace(/```/g, "``​`")}\n\`\`\``;
}

function messageLink(message: Message<boolean> | PartialMessage): string {
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

/**
 * Detail logging - nickname changes, message edits and deletions.
 *
 * Separate from ModLogService on purpose: that records deliberate moderator
 * actions against a member and writes a durable ModLog row per entry. These
 * are high-volume ambient events, so they are posted to a channel only and
 * never stored, which keeps them off a database that has filled up before.
 */
export class ServerLogService {
  private static findChannel(guild: Guild) {
    return guild.channels.cache.find(
      ({ name }) => name !== undefined && SERVER_LOG_CHANNELS.includes(name),
    );
  }

  static async post(guild: Guild, embed: APIEmbed): Promise<void> {
    if (!SERVER_LOG_CHANNELS.length) return;

    const channel = this.findChannel(guild);
    if (!channel?.isTextBased()) return;

    await (channel as TextChannel)
      .send({ embeds: [embed], allowedMentions: { users: [], roles: [] } })
      .catch(() => {
        // A log post must never break the thing it is reporting on.
      });
  }

  static async logNicknameChange(
    guild: Guild,
    memberId: string,
    username: string,
    before: string | null,
    after: string | null,
  ): Promise<void> {
    const embed = simpleEmbedExample();
    embed.description = [
      `**Member:** <@${memberId}> (${username})`,
      `**Before:** ${before ? `\`${before}\`` : "*(none)*"}`,
      `**After:** ${after ? `\`${after}\`` : "*(none)*"}`,
    ].join("\n");
    embed.footer!.text = "nickname changed";

    await this.post(guild, embed);
  }

  static async logMessageEdit(
    message: Message<boolean>,
    before: string | null | undefined,
  ): Promise<void> {
    if (!message.guild) return;

    const embed = simpleEmbedExample();
    embed.description = [
      `**Author:** <@${message.author.id}> (${message.author.username})`,
      `**Channel:** <#${message.channelId}>`,
      `**Before:**`,
      // An uncached original is common for older messages - say so rather than
      // implying the message was empty.
      before === null || before === undefined
        ? "*(not cached - the bot did not have the original)*"
        : quote(before),
      `**After:**`,
      quote(message.content),
      `[Jump to message](${messageLink(message)})`,
    ].join("\n");
    embed.footer!.text = "message edited";

    await this.post(message.guild, embed);
  }

  static async logMessageDelete(
    message: Message<boolean> | PartialMessage,
    content: string,
    authorId: string,
    authorName: string,
    deletedById: string,
  ): Promise<void> {
    if (!message.guild) return;

    const embed = simpleEmbedExample();
    embed.description = [
      `**Author:** <@${authorId}> (${authorName})`,
      `**Deleted by:** ${
        deletedById === authorId ? "*themselves*" : `<@${deletedById}>`
      }`,
      `**Channel:** <#${message.channelId}>`,
      `**Content:**`,
      quote(content),
    ].join("\n");
    embed.footer!.text = "message deleted";

    await this.post(message.guild, embed);
  }
}
