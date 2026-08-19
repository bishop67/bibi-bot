import { logEmbed } from "@/core/embeds/log.embed";
import { isLogExempt } from "@/core/services/logging/log-exempt";
import { SERVER_LOG_CHANNELS } from "@/shared/config/channels";
import type { ReadonlyCollection } from "@discordjs/collection";
import type {
  APIEmbed,
  Guild,
  GuildTextBasedChannel,
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

/**
 * Turn raw mention markup into something readable.
 *
 * Quoted content is fenced so nothing in it can ping, which also stops Discord
 * rendering `<@123...>` as a name - the log ends up showing a bare snowflake
 * where the message showed "@someone". Resolving it here restores the reading
 * without giving anything back: the result still sits inside the fence, and
 * a plain "@name" cannot notify anyone even outside one.
 *
 * Unresolvable ids keep their number rather than being dropped, since an
 * unknown mention is still information about what the message said.
 */
function readableMentions(
  content: string,
  guild: Message<boolean>["guild"],
): string {
  if (!guild) return content;

  return content
    .replace(/<@!?(\d+)>/g, (raw, id: string) => {
      const name =
        guild.members.cache.get(id)?.user.username ??
        guild.client.users.cache.get(id)?.username;
      return name ? `@${name}` : raw;
    })
    .replace(/<@&(\d+)>/g, (raw, id: string) => {
      const name = guild.roles.cache.get(id)?.name;
      return name ? `@${name}` : raw;
    })
    .replace(/<#(\d+)>/g, (raw, id: string) => {
      const name = guild.channels.cache.get(id)?.name;
      return name ? `#${name}` : raw;
    });
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
    if (isLogExempt(message.channel)) return;

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
            : quote(readableMentions(before, message.guild)),
          "**After**",
          quote(readableMentions(message.content, message.guild)),
        ],
        footer: "message edited",
      }),
    );
  }

  /**
   * A bulk deletion - a ban that cleared message history, or a jail sweep.
   *
   * Summarised rather than itemised. Discord bulk-deletes up to a hundred
   * messages at a time and a jail clears a fortnight of them, so one entry per
   * message would bury the channel and blow past the embed limit besides. The
   * bodies are deliberately left out for the same reason, and because these
   * sweeps are not stored anywhere - what makes the entry useful is who ran
   * it, where, and against whom.
   */
  static async logMessageBulkDelete(
    guild: Guild,
    channel: GuildTextBasedChannel,
    messages: ReadonlyCollection<string, Message<boolean> | PartialMessage>,
    deletedById: string | null,
  ): Promise<void> {
    if (isLogExempt(channel)) return;

    // Uncached messages carry no author, so this counts whoever can be named
    // and says plainly how many could not be.
    const byAuthor = new Map<string, number>();
    let unknown = 0;

    for (const message of messages.values()) {
      const authorId = message.author?.id;
      if (!authorId) {
        unknown += 1;
        continue;
      }
      byAuthor.set(authorId, (byAuthor.get(authorId) ?? 0) + 1);
    }

    const ranked = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);
    const shown = ranked.slice(0, 10);
    const remaining = ranked.length - shown.length;

    const authorLines = shown.map(
      ([authorId, count]) => `<@${authorId}> — ${count}`,
    );

    if (remaining > 0) authorLines.push(`*and ${remaining} other author(s)*`);

    if (unknown > 0)
      authorLines.push(`*${unknown} from uncached messages, author unknown*`);

    await this.post(
      guild,
      logEmbed({
        tone: "negative",
        title: `${messages.size} messages bulk deleted in #${channel.name}`,
        lines: [
          deletedById ? `Deleted by <@${deletedById}>` : "Deleted by *unknown*",
          ...authorLines,
        ],
        footer: "bulk delete",
      }),
    );
  }

  static async logMessageDelete(
    message: Message<boolean> | PartialMessage,
    content: string | null,
    author: User | null,
    authorId: string,
    deletedById: string,
  ): Promise<void> {
    if (!message.guild) return;
    if (isLogExempt(message.channel)) return;

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
          // Only the newest messages per channel are cached, so a moderator
          // clearing something older leaves us the fact of the deletion but not
          // its text. Saying so beats staying silent about the deletion.
          content === null || content === undefined
            ? "*(not cached - the bot did not have the message text)*"
            : quote(readableMentions(content, message.guild)),
        ],
        footer: "message deleted",
      }),
    );
  }
}
