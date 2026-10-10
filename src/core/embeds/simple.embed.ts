import { APIEmbed } from "discord.js";
import { botIcon, RED_COLOR } from "@/shared/config/branding";

export const simpleEmbedExample = (): APIEmbed => ({
  color: RED_COLOR,
  description: `*`,
  timestamp: new Date().toISOString(),
  footer: {
    text: "*",
    icon_url: botIcon(),
  },
});
