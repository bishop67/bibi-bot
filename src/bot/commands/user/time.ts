import { executeTime } from "@/core/handlers/command-handlers/user/time.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { TIMEZONE_CHOICES } from "@/shared/config/timezones";
import type { AutocompleteInteraction, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class Time {
  @Slash({
    name: "time",
    description: "Show the current time around the world, or in a specific place",
  })
  async time(
    @SlashOption({
      name: "location",
      description: "A city name (e.g. Tokyo) or IANA zone id (e.g. America/Chicago)",
      required: false,
      type: ApplicationCommandOptionType.String,
      autocomplete: (interaction: AutocompleteInteraction) => {
        const focused = interaction.options.getFocused().toLowerCase();
        const matches = (
          focused
            ? TIMEZONE_CHOICES.filter((c) =>
                c.label.toLowerCase().includes(focused),
              )
            : TIMEZONE_CHOICES
        ).slice(0, 25);

        return interaction.respond(
          matches.map((c) => ({ name: c.label, value: c.label })),
        );
      },
    })
    location: string | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;

    const result = await executeTime(location);

    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }
}