import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import { REPORT_CHANNELS } from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import type { MessageResult } from "@/types";
import type { CommandInteraction, TextChannel, User } from "discord.js";

export async function executeReport(
  interaction: CommandInteraction,
  target: User,
  reason: string,
): Promise<MessageResult> {
  if (!interaction.guild) {
    return { error: "This command can only be used in a server" };
  }

  if (target.id === interaction.member?.user.id) {
    return { error: "You can't report yourself" };
  }

  if (!ConfigValidator.isFeatureEnabled("REPORT_CHANNELS")) {
    ConfigValidator.logFeatureDisabled("Member Reports", "REPORT_CHANNELS");
    return {
      error: "Reports aren't configured on this server yet. Please contact a mod directly.",
    };
  }

  const reportChannel = interaction.guild.channels.cache.find(({ name }) =>
    REPORT_CHANNELS.includes(name),
  );

  if (!reportChannel || !reportChannel.isTextBased()) {
    return {
      error: "Couldn't find the configured report channel. Please contact a mod directly.",
    };
  }

  const reportEmbed = simpleEmbedExample();
  reportEmbed.description =
    `**Reported user:** ${target} (${target.username})\n` +
    `**Reported by:** ${interaction.member} (${interaction.member?.user.username})\n\n` +
    `**Reason:**\n${reason}`;
  reportEmbed.footer!.text = "report";

  try {
    await (reportChannel as TextChannel).send({
      embeds: [reportEmbed],
      allowedMentions: { users: [], roles: [] },
    });
  } catch {
    return { error: "Failed to submit the report. Please contact a mod directly." };
  }

  return { message: "Your report has been submitted to the moderators." };
}
