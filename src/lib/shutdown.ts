import { MemberUpdateQueueService } from "@/core/services/members/member-update-queue.service";
import { PresenceWriterService } from "@/core/services/members/presence-writer.service";
import { botLogger, shutdownTelemetry } from "@/lib/telemetry";

/**
 * Flushes what is buffered in memory, then exits.
 *
 * Shared by the signal handlers and /restart, which differ only in the exit
 * code: a signal is the host stopping the bot on purpose, while /restart
 * exits non-zero so the host's crash detection starts it again.
 */
export async function shutdown(reason: string, exitCode: number) {
  botLogger.info("Shutting down", { reason });
  MemberUpdateQueueService.stop();
  await PresenceWriterService.stop();
  await shutdownTelemetry();
  process.exit(exitCode);
}
