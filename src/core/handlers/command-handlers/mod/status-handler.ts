import os from "os";
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

export async function executeStatus(
  _interaction: CommandInteraction,
): Promise<{ embeds: EmbedBuilder[] }> {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const loadAvg = os.loadavg();

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
        name: "Memory (RSS)",
        value: formatBytes(mem.rss),
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
      {
        name: "System Load (1m/5m/15m)",
        value: loadAvg.map((n) => n.toFixed(2)).join(" / "),
        inline: true,
      },
      {
        name: "System Memory",
        value: `${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}`,
        inline: true,
      },
    )
    .setTimestamp();

  return { embeds: [embed] };
}