import { MessagesService } from "@/core/services/messages/messages.service";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageDelete {
  @On()
  async messageDelete([message]: ArgsOf<"messageDelete">, client: Client) {
    MessagesService.deleteMessageDb(message);

    MessagesService.saveDeletedMessageHistory(message);
  }
}
