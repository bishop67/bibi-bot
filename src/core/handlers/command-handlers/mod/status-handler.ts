import { readFileSync } from "fs";
import { EmbedBuilder, type CommandInteraction } from "discord.js";

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(2)} MB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Reads the actual container memory limit from cgroups, since os.totalmem()
 * reports the HOST machine's memory, not the container's real allocation.
 * Tries cgroup v2 first, then falls back to v1. Returns null if unavailable
 * (e.g. running outside a container, or the limit is "unlimited").
 */
function getContainerMemoryLimit(): number | null {
  try {
    // cgroup v2
    const v2 = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (v2 !== "max") return parseInt(v2, 10);
  } catch {
    // ignore, try v1 below
  }

  try {
    // cgroup v1
    const v1 = readFileSync(
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      "utf8",
    ).trim();
    const limit = parseInt(v1, 10);
    // v1 reports an absurdly large number (e.g. ~9223372036854771712) when unlimited
    if (limit < Number.MAX_SAFE_INTEGER / 2) return limit;
  } catch {
    // ignore
  }

  return null;
}

export async function executeStatus(
  _interaction: CommandInteraction,
): Promise<{ embeds: EmbedBuilder[] }> {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;

  const containerLimit = getContainerMemoryLimit();
  const memoryField = containerLimit
    ? `${formatBytes(mem.rss)} / ${formatBytes(containerLimit)} (${((mem.rss / containerLimit) * 100).toFixed(1)}%)`
    : `${formatBytes(mem.rss)} (container limit unavailable)`;

  const embed = new EmbedBuilder()
    .setTitle("Bot Status")
    .setColor(0x5865f2)
    .addFields(
      {
        name: "Uptime",
        value: formatUptime(process.uptime()),
        inline: true,
      },
      {
        name: "Memory (RSS / Container Limit)",
        value: memoryField,
        inline: true,
      },
      {
        name: "Heap Used / Total",
        value: `${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
        inline: true,
      },
      {
        name: "CPU Time (process)",
        value: `${cpuMs.toFixed(0)} ms`,
        inline: true,
      },
    )
    .setFooter({
      text: "Note: memory shown is this process only, scoped to the container limit, not the shared host machine.",
    })
    .setTimestamp();

  return { embeds: [embed] };
}
