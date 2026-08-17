import { SPAM_EXEMPT_CHANNELS } from "@/shared/config/channels";
import { SPAM_EXEMPT_ROLES } from "@/shared/config/roles";
import type { Message, TextChannel } from "discord.js";

/**
 * Whether the automated filters should leave this message alone.
 *
 * Exemption is one concept - a trusted channel or a trusted role - so every
 * filter has to agree on it. Applying it to only some of them is how a member
 * with an exempt role still gets warned, and eventually jailed, by the one
 * filter that never checked.
 */
export function isSpamExempt(message: Message): boolean {
  const channelName = (message.channel as TextChannel)?.name ?? "";
  if (SPAM_EXEMPT_CHANNELS.includes(channelName)) return true;

  return Boolean(
    message.member?.roles.cache.some((role) =>
      SPAM_EXEMPT_ROLES.includes(role.name),
    ),
  );
}
