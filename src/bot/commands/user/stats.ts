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
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

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
@SlashGroup({
  name: "stats",
  description: "Server and member statistics",
  dmPermission: false,
})
@SlashGroup("stats")
export class StatsCommands {
  @Slash({ name: "me", description: "Get your stats" })
  async me(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, "stats me");

    const result = await executeUserStatsCommand(interaction);
    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({ name: "user", description: "Get stats for a specific member" })
  async user(
    @SlashOption({
      name: "user",
      description: "Select user which stats should be shown",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, "stats user");

    const result = await executeUserStatsCommand(interaction, user.id);
    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({ name: "top", description: "Get top stats for the guild" })
  async top(
    @SlashOption({
      name: "lookback",
      description: "Lookback days",
      required: false,
      minValue: 1,
      maxValue: 9999,
      type: ApplicationCommandOptionType.Integer,
    })
    lookback: number = 9999,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, "stats top");

    const result = await executeTopCommand(interaction, lookback);
    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({ name: "members", description: "Memberflow and count of the past" })
  async members(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, "stats members");

    const result = await executeMembersCommand(interaction);
    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      files: [result.attachment],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
