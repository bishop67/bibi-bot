import { botLogger } from "@/lib/telemetry";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { APICallError, RetryError } from "ai";

type RawModelId = Parameters<GoogleGenerativeAIProvider>[0];
type ModelId = RawModelId extends infer T
  ? T extends string
    ? string extends T
      ? never
      : T
    : never
  : never;

// gemini-2.5-flash was here and is retired: it answers 404 with "no longer
// available to new users". It still appears in ListModels, so the only way to
// find out is to call it - which the rotation now survives either way.
const FALLBACK_MODELS: ModelId[] = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
];

/**
 * The keys, shuffled once.
 *
 * This used to shuffle inside getApiKeys(), which the comment claimed happened
 * "once at startup" but actually happened on every call - and the error path
 * calls it to name the key that just failed. Reshuffling there meant the index
 * pointed into a freshly reordered list, so "API key invalid" reported a key
 * chosen at random rather than the one that broke.
 */
const API_KEYS: string[] = (() => {
  const keys =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.split(",")
      .map((k) => k.trim())
      .filter(Boolean) ?? [];

  // Different instances should not all start on the same key.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
})();

function getApiKeys() {
  return API_KEYS;
}

function createGoogleProviders() {
  const keys = getApiKeys();
  return keys.map((apiKey) => createGoogleGenerativeAI({ apiKey }));
}

function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function getAPICallError(
  error: unknown,
): InstanceType<typeof APICallError> | null {
  if (APICallError.isInstance(error)) return error;
  if (
    RetryError.isInstance(error) &&
    APICallError.isInstance(error.lastError)
  ) {
    return error.lastError;
  }
  return null;
}

type ErrorCategory =
  | "rate_limit"
  | "key_error"
  | "model_error"
  | "non_retryable"
  | "image_download"
  | "unknown";

export class ImageDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageDownloadError";
  }
}

function categorizeError(error: unknown): ErrorCategory {
  // Check message first, since Gemini wraps download failures in various HTTP statuses
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Failed to download")) return "image_download";
  // A dead/revoked key returns 400 INVALID_ARGUMENT "API Key not found" with no
  // APICallError wrapper; must rotate to the next key, not stop the whole request.
  if (
    message.includes("API_KEY_INVALID") ||
    message.includes("API Key not found") ||
    message.includes("API key not valid")
  )
    return "key_error";
  if (message.includes("INVALID_ARGUMENT")) return "non_retryable";

  const apiError = getAPICallError(error);

  if (apiError) {
    // Also check response body for download failures (Gemini wraps them in 4xx/5xx)
    const body = apiError.responseBody || "";
    if (body.includes("Failed to download")) return "image_download";

    // Key errors first: a bad key can surface as 400/404, but should rotate
    // keys rather than stop, so it must beat the status-based non_retryable below.
    if (
      body.includes("API_KEY_INVALID") ||
      body.includes("PERMISSION_DENIED") ||
      body.includes("API Key not found")
    )
      return "key_error";

    // HTTP status-based detection
    if (apiError.statusCode === 429) return "rate_limit";
    if (apiError.statusCode === 403) return "key_error";
    // A retired or misspelled model answers 404. That says nothing about the
    // request or the key, only about this one model, so it has to fall through
    // to the next one - as non_retryable it killed the whole call instead, and
    // the entire fallback list below it was unreachable.
    if (apiError.statusCode === 404) return "model_error";
    if (apiError.statusCode === 400) return "non_retryable";

    // Capacity, not quota. Google answers a busy model with 503 UNAVAILABLE,
    // which is temporary and worth falling back over - but it matched none of
    // the quota wording below and came out "unknown".
    if (apiError.statusCode === 503) return "rate_limit";

    // Response body-based detection for ambiguous status codes
    if (
      body.includes("RESOURCE_EXHAUSTED") ||
      body.includes("rateLimitExceeded") ||
      body.includes("UNAVAILABLE")
    )
      return "rate_limit";
  }

  if (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("quota") ||
    message.includes("overloaded") ||
    message.includes("The model is overloaded") ||
    // Google's actual wording for a busy model, which matches none of the
    // above and so was classified "unknown" - seen live as "This model is
    // currently experiencing high demand. Spikes in demand are usually
    // temporary. Please try again later."
    message.includes("experiencing high demand") ||
    message.includes("Spikes in demand") ||
    message.includes("UNAVAILABLE")
  )
    return "rate_limit";

  if (
    message.includes("API_KEY_INVALID") ||
    message.includes("API key not valid") ||
    message.includes("PERMISSION_DENIED")
  )
    return "key_error";

  return "unknown";
}

class GoogleClientRotator {
  private providers = createGoogleProviders();
  private currentKeyIndex = 0;
  private currentModelIndex = 0;

  getModel(modelName?: string) {
    const model = modelName || FALLBACK_MODELS[this.currentModelIndex];
    return this.providers[this.currentKeyIndex](model);
  }

  private rotateKey() {
    if (this.providers.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.providers.length;
      botLogger.info("Rotated API key", {
        keyIndex: this.currentKeyIndex + 1,
        totalKeys: this.providers.length,
      });
    }
  }

  private rotateModel(): boolean {
    const nextModelIndex = this.currentModelIndex + 1;
    if (nextModelIndex < FALLBACK_MODELS.length) {
      this.currentModelIndex = nextModelIndex;
      botLogger.info("Rotated model", {
        model: FALLBACK_MODELS[this.currentModelIndex],
        modelIndex: this.currentModelIndex + 1,
        totalModels: FALLBACK_MODELS.length,
      });
      return true;
    }
    return false;
  }

  async executeWithRotation<T>(
    operation: (
      model: ReturnType<GoogleClientRotator["getModel"]>,
    ) => Promise<T>,
  ): Promise<T | null> {
    if (this.providers.length === 0) {
      botLogger.error("No API keys configured");
      return null;
    }

    const startModelIndex = this.currentModelIndex;
    const startKeyIndex = this.currentKeyIndex;
    let lastError: unknown;
    let lastCategory: ErrorCategory = "unknown";
    let lastMessage = "";
    // Unidentifiable failures seen in this request, against the model that
    // first produced each. Repeating on the same model rules out the key;
    // repeating on a different one rules out the model too.
    const unknownFirstSeenOnModel = new Map<string, number>();

    botLogger.info("Starting AI request", {
      model: FALLBACK_MODELS[this.currentModelIndex],
      keyIndex: this.currentKeyIndex + 1,
      totalKeys: this.providers.length,
    });

    do {
      const keyStartIndex = this.currentKeyIndex;
      let skipRemainingKeys = false;

      do {
        try {
          const model = this.getModel();
          const result = await operation(model);
          // Treat empty text responses as failures - continue rotating
          const hasContent =
            result && typeof result === "object" && "text" in result
              ? !!(result as { text?: string }).text?.trim()
              : !!result;
          if (!hasContent) {
            botLogger.warn("Empty response, rotating", {
              model: FALLBACK_MODELS[this.currentModelIndex],
            });
            this.rotateKey();
            continue;
          }
          botLogger.info("AI request succeeded", {
            model: FALLBACK_MODELS[this.currentModelIndex],
          });

          // Back to the preferred model for the next request. Nothing used to
          // reset this on success - only the two failure paths did - so a
          // single capacity spike on the first model demoted the bot to the
          // second one permanently, the next spike moved it to the third, and
          // it walked down the list until it sat on the weakest model for good.
          // The fallbacks are for getting through a bad minute, not for
          // choosing which model the bot runs on.
          this.currentModelIndex = 0;

          return result;
        } catch (error) {
          lastError = error;
          const message =
            error instanceof Error ? error.message : String(error);
          lastMessage = message;
          lastCategory = categorizeError(error);

          const apiError = getAPICallError(error);

          botLogger.error("AI error", {
            model: FALLBACK_MODELS[this.currentModelIndex],
            keyIndex: this.currentKeyIndex + 1,
            category: lastCategory,
            message,
            // "unknown" means every branch above declined it, so the message
            // alone has already proved insufficient to identify it. The status
            // and the body are what actually say what happened - without them
            // an unrecognised failure logs a line that cannot be acted on.
            // "Invalid JSON response" is the case in point: the SDK raises it
            // when Google's response body fails its schema, and the reason is
            // only ever in the cause and the body.
            ...(lastCategory === "unknown" && apiError
              ? {
                  statusCode: apiError.statusCode,
                  cause: String(apiError.cause ?? "").slice(0, 300),
                  responseBody: (apiError.responseBody ?? "").slice(0, 500),
                }
              : {}),
          });

          if (lastCategory === "image_download") {
            botLogger.warn(
              "Image download failed, caller should retry without images",
            );
            throw new ImageDownloadError(message);
          }

          // An unidentifiable failure that repeats says where the fault is not,
          // and each further attempt costs a request the free tier cannot
          // spare. Same message on the same model means the key is not at
          // fault, so the remaining keys are skipped and the next model tried.
          // Same message on a different model means the request itself is
          // wrong, and nothing further is worth spending - production burned
          // four models on one repeated "Invalid JSON response", which with a
          // second key would have been eight.
          //
          // Deliberately not applied to rate limits, which are per key and per
          // model: there, rotating is the entire point and does find quota.
          if (lastCategory === "unknown") {
            const firstModel = unknownFirstSeenOnModel.get(message);

            if (firstModel === undefined) {
              unknownFirstSeenOnModel.set(message, this.currentModelIndex);
            } else if (firstModel !== this.currentModelIndex) {
              botLogger.warn(
                "Same failure on a second model - the request is at fault, stopping",
                { message },
              );
              this.currentModelIndex = startModelIndex;
              this.currentKeyIndex = startKeyIndex;
              return null;
            } else {
              botLogger.warn(
                "Same failure on another key - not the key, trying the next model",
                { message },
              );
              skipRemainingKeys = true;
              break;
            }
          }

          if (lastCategory === "model_error") {
            // Every key will get the same answer from a model that does not
            // exist, so there is nothing to gain by working through them.
            botLogger.warn("Model unavailable, trying the next one", {
              model: FALLBACK_MODELS[this.currentModelIndex],
            });
            skipRemainingKeys = true;
            break;
          }

          if (lastCategory === "non_retryable") {
            botLogger.warn("Non-retryable error, stopping");
            return null;
          }

          if (lastCategory === "key_error") {
            const expiredKey = getApiKeys()[this.currentKeyIndex];
            if (expiredKey) {
              botLogger.warn("API key invalid", {
                key: maskApiKey(expiredKey),
              });
            }
          }

          this.rotateKey();
        }
      } while (this.currentKeyIndex !== keyStartIndex);

      // All keys exhausted for this model
      // If last error was key_error, don't try other models (same keys will fail)
      // - unless the model itself is the problem, where the keys are fine.
      if (!skipRemainingKeys && lastCategory === "key_error") {
        botLogger.warn("All keys invalid, stopping");
        this.currentModelIndex = startModelIndex;
        this.currentKeyIndex = startKeyIndex;
        return null;
      }

      // Try next model for rate_limit or unknown errors
      if (!this.rotateModel()) {
        this.currentModelIndex = startModelIndex;
        this.currentKeyIndex = startKeyIndex;
        break;
      }
      this.currentKeyIndex = 0;
    } while (this.currentModelIndex !== startModelIndex);

    botLogger.warn("All models and keys exhausted", {
      totalModels: FALLBACK_MODELS.length,
      totalKeys: this.providers.length,
    });
    const finalMessage =
      lastError instanceof Error ? lastError.message : String(lastError);
    botLogger.error("Last error", { message: finalMessage });

    return null;
  }
}

export const googleClient = new GoogleClientRotator();
