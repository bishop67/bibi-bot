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

function getContainerMemoryLimit(): number | null {
  try {
    const v2 = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (v2 !== "max") return parseInt(v2, 10);
  } catch {
    // ignore, try v1 below
  }

  try {
    const v1 = readFileSync(
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      "utf8",
    ).trim();
    const limit = parseInt(v1, 10);
    if (limit < Number.MAX_SAFE_INTEGER / 2) return limit;
  } catch {
    // ignore
  }

  return null;
}

export async function executeStatus(
  interaction: CommandInteraction,
): Promise<{ embeds: EmbedBuilder[] }> {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const uptimeSeconds = process.uptime();

  const heapTotalSafe = Math.max(mem.heapTotal, mem.heapUsed);
  const heapPercent = ((mem.heapUsed / heapTotalSafe) * 100).toFixed(1);

  const containerLimit = getContainerMemoryLimit();
  const memoryField = containerLimit
    ? `${formatBytes(mem.rss)} / ${formatBytes(containerLimit)} (${((mem.rss / containerLimit) * 100).toFixed(1)}%)`
    : `${formatBytes(mem.rss)} (container limit unavailable)`;

  const cpuPercent =
    uptimeSeconds > 0
      ? ((cpuMs / (uptimeSeconds * 1000)) * 100).toFixed(1)
      : "0.0";

  const client = interaction.client;
  const ping = client.ws.ping >= 0 ? `${client.ws.ping} ms` : "calculating...";
  const guildCount = client.guilds.cache.size;
  const cachedMembers = client.guilds.cache.reduce(
    (total, guild) => total + guild.members.cache.size,
    0,
  );

  const embed = new EmbedBuilder()
    .setTitle("Bot Status")
    .setColor(0x5865f2)
    .addFields(
      { name: "Uptime", value: formatUptime(uptimeSeconds), inline: true },
      { name: "Memory (RSS / Container Limit)", value: memoryField, inline: true },
      { name: "Heap (Used / Total)", value: `${formatBytes(mem.heapUsed)} / ${formatBytes(heapTotalSafe)} (${heapPercent}%)`, inline: true },
      { name: "External / Buffers", value: `${formatBytes(mem.external)} / ${formatBytes(mem.arrayBuffers)}`, inline: true },
      { name: "CPU Time (process)", value: `${cpuMs.toFixed(0)} ms (${cpuPercent}% of uptime)`, inline: true },
      { name: "Gateway Ping", value: ping, inline: true },
      { name: "Guilds Cached", value: `${guildCount}`, inline: true },
      { name: "Members Cached", value: `${cachedMembers}`, inline: true },
      { name: "Runtime", value: `Bun ${process.versions.bun ?? "unknown"}`, inline: true },
    )
    .setFooter({
      text: "Memory figures are for this process only, measured against this container's actual memory limit — not the shared host machine's total.",
    })
    .setTimestamp();

  return { embeds: [embed] };
}
