import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import {
  DEFAULT_WORLD_CLOCK_ZONES,
  formatZoneTime,
  resolveTimeZone,
} from "@/shared/config/timezones";
import type { EmbedResult } from "@/types";

export async function executeTime(location?: string): Promise<EmbedResult> {
  const now = new Date();
  const embed = simpleEmbedExample();

  if (!location) {
    embed.description = DEFAULT_WORLD_CLOCK_ZONES.map((zone) => {
      const { time, date, offset } = formatZoneTime(zone, now);
      const label = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
      return `**${label}** - ${time} (${date}) \`${offset}\``;
    }).join("\n");
    embed.footer!.text = "World clock • /time <location> for a specific place";

    return { embed };
  }

  const zone = resolveTimeZone(location);

  if (!zone) {
    return {
      error: `Couldn't find a timezone matching "${location}". Try a major city name or an IANA zone id like "America/Chicago".`,
    };
  }

  const { time, date, offset } = formatZoneTime(zone, now);
  embed.description = `**${time}** on ${date}\n\`${zone}\` (\`${offset}\`)`;
  embed.footer!.text = "time";

  return { embed };
}