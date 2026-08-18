import { executeBackfillMessages } from "@/core/handlers/command-handlers/mod/backfill-messages.handler";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

@Discord()
export class BackfillMessages {
  /**
   * A prefix command rather than a slash one: this runs for minutes on a
   * server of any size, and a slash interaction cannot be replied to for
   * anywhere near that long.
   */
  @SimpleCommand({ aliases: ["backfill-messages"], prefix: "!" })
  async backfillMessages(command: SimpleCommandMessage) {
    const result = await executeBackfillMessages(command);

    if (result.error) {
      await command.message.reply({ content: result.error });
    }
  }
}
