import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import { WarningsService } from "@/core/services/moderation/warnings.service";
import type { EmbedResult } from "@/types";
import type { CommandInteraction, User } from "discord.js";

export async function executeWarnings(
  interaction: CommandInteraction,
  target: User,
  page: number,
): Promise<EmbedResult> {
  if (!interaction.guild) {
    return { error: "This command can only be used in a server" };
  }

  const { warnings, total, totalPages } = await WarningsService.getWarnings(
    interaction.guild.id,
    target.id,
    Math.max(0, page - 1),
  );

  if (total === 0) {
    return { error: `${target.username} has no warnings.` };
  }

  const embed = simpleEmbedExample();
  embed.description = warnings
    .map(
      (w) =>
        `**#${w.id}** - ${w.reason}\n` +
        `by ${w.moderator?.username ?? "automod"} • <t:${Math.floor(new Date(w.createdAt).getTime() / 1000)}:R>`,
    )
    .join("\n\n");
  embed.footer!.text = `${target.username} • ${total} warning${total === 1 ? "" : "s"} • page ${Math.max(1, page)}/${totalPages}`;

  return { embed };
}
