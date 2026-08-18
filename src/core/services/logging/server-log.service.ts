import { logEmbed } from "@/core/embeds/log.embed";
import { SERVER_LOG_CHANNELS } from "@/shared/config/channels";
import type {
  APIEmbed,
  Guild,
  Message,
  PartialMessage,
  TextChannel,
  User,
} from "discord.js";

/** Discord rejects embed descriptions past 4096; leave room for the labels. */
const MAX_CONTENT = 900;

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT) return content;
  return `${content.slice(0, MAX_CONTENT)}… *(truncated)*`;
}

/**
 * Quote a message body.
 *
 * Fenced so mentions, markdown and invite links in the original cannot render
 * or ping from inside the log itself. The zero-width space defuses a fence
 * inside the content that would otherwise break out of this one.
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
 * actions and writes a durable ModLog row per entry. These are high-volume
 * ambient events, so they are posted to a channel only and never stored, which
 * keeps them off a database that has filled up before.
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
    user: User,
    before: string | null,
    after: string | null,
  ): Promise<void> {
    await this.post(
      guild,
      logEmbed({
        tone: "neutral",
        user,
        title: "Nickname changed",
        lines: [
          `<@${user.id}>`,
          `**Before:** ${before ? `\`${before}\`` : "*(none)*"}`,
          `**After:** ${after ? `\`${after}\`` : "*(none)*"}`,
        ],
        footer: "nickname changed",
      }),
    );
  }

  static async logMessageEdit(
    message: Message<boolean>,
    before: string | null | undefined,
  ): Promise<void> {
    if (!message.guild) return;

    await this.post(
      message.guild,
      logEmbed({
        tone: "caution",
        user: message.author,
        title: `Message edited in #${
          "name" in message.channel ? message.channel.name : "unknown"
        }`,
        lines: [
          `<@${message.author.id}> · [jump](${messageLink(message)})`,
          "**Before**",
          // An uncached original is normal for older messages - say so rather
          // than implying the message was empty.
          before === null || before === undefined
            ? "*(not cached - the bot did not have the original)*"
            : quote(before),
          "**After**",
          quote(message.content),
        ],
        footer: "message edited",
      }),
    );
  }

  static async logMessageDelete(
    message: Message<boolean> | PartialMessage,
    content: string,
    author: User | null,
    authorId: string,
    deletedById: string,
  ): Promise<void> {
    if (!message.guild) return;

    await this.post(
      message.guild,
      logEmbed({
        tone: "negative",
        user: author,
        title: `Message deleted in #${
          message.channel && "name" in message.channel
            ? message.channel.name
            : "unknown"
        }`,
        lines: [
          `<@${authorId}> · deleted by ${
            deletedById === authorId ? "*themselves*" : `<@${deletedById}>`
          }`,
          quote(content),
        ],
        footer: "message deleted",
      }),
    );
  }
}
