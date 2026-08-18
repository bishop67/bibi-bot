import { executeMembersCommand } from "@/core/handlers/command-handlers/user/members.handler";
import { executeTopCommand } from "@/core/handlers/command-handlers/user/top.handler";
import { executeUserStatsCommand } from "@/core/handlers/command-handlers/user/user.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import {
  ApplicationCommandOptionType,
  User,
  type CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

type StatsType = "me" | "user" | "top" | "members";

/** Command history is best-effort and must never delay the reply. */
function record(interaction: CommandInteraction, command: string) {
  if (!interaction.member?.user.id || !interaction.guildId) return;

  db.insert(memberCommandHistory)
    .values({
      channelId: interaction.channelId,
      memberId: interaction.member.user.id,
      guildId: interaction.guildId,
      command,
    })
    .catch(() => {});
}

@Discord()
export class StatsCommands {
  /**
   * One command with a `type` choice rather than four subcommands.
   *
   * Discord lists every subcommand as its own row in the picker, so a group
   * reads as four separate commands however it is declared. The cost of
   * collapsing them is that `user` and `lookback` cannot be attached to the
   * one choice they belong to - Discord has no way to vary options per choice
   * - so they are offered always and checked here instead.
   */
  @Slash({
    name: "stats",
    description: "Server and member statistics",
    dmPermission: false,
  })
  async stats(
    @SlashChoice({ name: "me - your own stats", value: "me" })
    @SlashChoice({ name: "member - stats for someone else", value: "user" })
    @SlashChoice({ name: "top - guild leaderboard", value: "top" })
    @SlashChoice({ name: "members - member flow and count", value: "members" })
    @SlashOption({
      name: "type",
      description: "Which statistics to show",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    type: StatsType,
    @SlashOption({
      name: "user",
      description: "Whose stats to show (only used with type: member)",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    user: User | undefined,
    @SlashOption({
      name: "lookback",
      description: "Days to look back (only used with type: top)",
      required: false,
      minValue: 1,
      maxValue: 9999,
      type: ApplicationCommandOptionType.Integer,
    })
    lookback: number | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, `stats ${type}`);

    // Discord cannot stop someone pairing an option with the wrong choice, so
    // say which pairing was expected rather than quietly ignoring it.
    if (type === "user" && !user) {
      return safeEditReply(
        interaction,
        "Pick someone with the `user` option, or choose type: me for your own stats.",
      );
    }

    if (type === "members") {
      const result = await executeMembersCommand(interaction);
      if ("error" in result) return safeEditReply(interaction, result.error);

      return safeEditReply(interaction, {
        embeds: [result.embed],
        files: [result.attachment],
        allowedMentions: { users: [], roles: [] },
      });
    }

    const result =
      type === "top"
        ? await executeTopCommand(interaction, lookback ?? 9999)
        : await executeUserStatsCommand(
            interaction,
            type === "user" ? user!.id : undefined,
          );

    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
