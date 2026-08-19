import { log, error } from "console";
import { Message, StickerFormatType } from "discord.js";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_CONTENT_LENGTH = 8000;

export async function extractCodeFromAttachments(
  message: Message,
): Promise<string | null> {
  let extractedCode = "";

  for (const attachment of message.attachments.values()) {
    const { name, url, contentType, size } = attachment;

    if (size && size > MAX_FILE_SIZE) {
      log(`Skipping large file: ${name} (${size} bytes)`);
      continue;
    }

    if (contentType?.startsWith("text/") || !contentType) {
      try {
        log(`Fetching code from attachment: ${name}`);
        // Bounded: an unresponsive CDN would otherwise stall the AI reply.
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          error(`Failed to fetch ${name}: ${response.status}`);
          continue;
        }

        const content = await response.text();
        const truncatedContent =
          content.length > MAX_CONTENT_LENGTH
            ? content.substring(0, MAX_CONTENT_LENGTH) +
              "\n... (content truncated)"
            : content;

        if (extractedCode) {
          extractedCode += `\n\n--- File: ${name} ---\n`;
        } else {
          extractedCode += `--- File: ${name} ---\n`;
        }
        extractedCode += truncatedContent;
      } catch (err) {
        error(`Error fetching attachment ${name}:`, err);
      }
    }
  }

  return extractedCode || null;
}

/**
 * An image to send to the model, with the type the AI SDK needs alongside it.
 *
 * The URL alone was enough for the deprecated "image" content part, which
 * guessed the type itself. A "file" part will not guess, so the content type
 * has to survive the trip from the attachment - it was being read here to
 * filter on, then thrown away.
 */
export interface AiImage {
  url: string;
  mediaType: string;
}

export async function extractImageUrls(message: Message): Promise<AiImage[]> {
  const images: AiImage[] = [];

  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith("image/")) continue;
    if (attachment.contentType === "image/gif") continue;

    try {
      const response = await fetch(attachment.url, { method: "HEAD" });
      if (response.ok) {
        images.push({ url: attachment.url, mediaType: attachment.contentType });
      }
    } catch {
      // Skip inaccessible images
    }
  }

  for (const sticker of message.stickers.values()) {
    if (sticker.format === StickerFormatType.Lottie) continue;
    if (
      sticker.format !== StickerFormatType.PNG &&
      sticker.format !== StickerFormatType.APNG
    )
      continue;

    try {
      const response = await fetch(sticker.url, { method: "HEAD" });
      if (response.ok) {
        // Both surviving sticker formats are PNG; APNG is a PNG extension.
        images.push({ url: sticker.url, mediaType: "image/png" });
      }
    } catch {
      // Skip inaccessible stickers
    }
  }

  return images;
}
