import { executeReport } from "@/core/handlers/command-handlers/user/report.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { MessageFlags } from "discord.js";
import type { CommandInteraction, GuildMember, User } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class Report {
  @Slash({
    name: "report",
    description: "Anonymously report a member to the moderators",
    dmPermission: false,
  })
  async report(
    @SlashOption({
      name: "user",
      description: "The member to report",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    rawUser: User | GuildMember,
    @SlashOption({
      name: "reason",
      description: "Why are you reporting this member?",
      maxLength: 500,
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ) {
    // discordx passes a GuildMember when the user is in the server, which has
    // no .username of its own.
    const user = "user" in rawUser ? rawUser.user : rawUser;

    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral })))
      return;

    // Not written to command history: /logs commands would reveal who sent
    // each anonymous report.
    const result = await executeReport(interaction, user, reason);

    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, result.message);
  }
}
