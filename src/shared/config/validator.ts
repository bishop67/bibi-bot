/// <reference path="../../types/env.d.ts" />
import "@dotenvx/dotenvx/config";
import { log, warn } from "console";

type EnvKey = keyof FeatureBotEnvironment;

/**
 * A switch that turns a feature off even when everything it needs is set.
 *
 * `defaultOn` carries the two polarities that already exist in features.ts:
 * the SHOULD_* flags are opt-in and mean nothing unless they read exactly
 * "true", while PRIVILEGED_INTENTS_ENABLED and BACKGROUND_WORKERS_ENABLED are
 * opt-out and stay on until something says "false". Reading a toggle as "set
 * to anything" gets the opt-in ones exactly backwards.
 */
interface FeatureToggle {
  key: EnvKey;
  defaultOn: boolean;
}

interface ConfigCheck {
  feature: string;
  /** Every one of these must hold a value before the feature can do anything. */
  keys?: EnvKey[];
  toggle?: FeatureToggle;
}

export class ConfigValidator {
  /**
   * One entry per feature, not per variable.
   *
   * Several features need a name list *and* a switch - levelling needs
   * LEVEL_ROLES and SHOULD_USER_LEVEL_UP - and listing those separately both
   * printed the feature twice and made the total count variables rather than
   * features.
   */
  private static checks: ConfigCheck[] = [
    {
      feature: "AI Chat & Spam Detection",
      keys: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    },
    { feature: "GIF Search", keys: ["KLIPY_API_KEY"] },
    { feature: "Helper Role System", keys: ["HELPER_ROLES"] },
    { feature: "Status Role Management", keys: ["STATUS_ROLES"] },
    {
      feature: "Level Up System",
      keys: ["LEVEL_ROLES"],
      toggle: { key: "SHOULD_USER_LEVEL_UP", defaultOn: false },
    },
    {
      feature: "Bot Channel Restrictions",
      keys: ["BOT_CHANNELS"],
      toggle: { key: "IS_CONSTRAINED_TO_BOT_CHANNEL", defaultOn: false },
    },
    {
      feature: "Voice Event Logging",
      keys: ["VOICE_EVENT_CHANNELS"],
      toggle: { key: "SHOULD_LOG_VOICE_EVENTS", defaultOn: false },
    },
    {
      feature: "Join/Leave Event Logging",
      keys: ["JOIN_EVENT_CHANNELS"],
    },
    {
      feature: "Member Count Display",
      keys: ["MEMBERS_COUNT_CHANNELS"],
      toggle: { key: "SHOULD_COUNT_MEMBERS", defaultOn: false },
    },
    { feature: "Member Reports", keys: ["REPORT_CHANNELS"] },
    {
      feature: "Template Validation Notifications",
      keys: ["TEMPLATE_VALIDATION_CHANNELS"],
    },
    { feature: "Moderation Log", keys: ["MOD_LOG_CHANNELS"] },
    { feature: "Custom Bot Icon", keys: ["BOT_ICON"] },
    // Reported even though they need no configuration: these are the two
    // switches that quietly turn off the most. Without message content every
    // filter reports clean on everything, and without the workers member data
    // queues up forever - both worth seeing in the summary rather than
    // inferring from their absence.
    {
      feature: "Privileged Intents (spam filters, member tracking)",
      toggle: { key: "PRIVILEGED_INTENTS_ENABLED", defaultOn: true },
    },
    {
      feature: "Background Workers (member data updates)",
      toggle: { key: "BACKGROUND_WORKERS_ENABLED", defaultOn: true },
    },
  ];

  private static evaluate(check: ConfigCheck): {
    enabled: boolean;
    reason?: string;
  } {
    if (check.toggle) {
      const raw = process.env[check.toggle.key]?.trim();
      const on = check.toggle.defaultOn ? raw !== "false" : raw === "true";

      if (!on) {
        return {
          enabled: false,
          reason: check.toggle.defaultOn
            ? `${check.toggle.key} is set to false`
            : `${check.toggle.key} is not "true"`,
        };
      }
    }

    const missing = (check.keys ?? []).filter((key) => {
      const value = process.env[key];
      return !value || value.trim() === "";
    });

    if (missing.length) {
      return { enabled: false, reason: `missing ${missing.join(", ")}` };
    }

    return { enabled: true };
  }

  public static validateConfig(): void {
    log("🔧 Checking bot configuration...");

    const results = this.checks.map((check) => ({
      check,
      ...this.evaluate(check),
    }));

    const enabled = results.filter((result) => result.enabled);
    const disabled = results.filter((result) => !result.enabled);

    if (enabled.length > 0) {
      log("✅ Configured features:");
      enabled.forEach(({ check }) => log(`   - ${check.feature}`));
    }

    if (disabled.length > 0) {
      warn("⚠️  Features disabled:");
      disabled.forEach(({ check, reason }) =>
        warn(`   - ${check.feature} (${reason})`),
      );
      warn("   Check your .env file to enable these features.");
    }

    log(
      `📊 Configuration: ${enabled.length}/${this.checks.length} features enabled\n`,
    );
  }

  /**
   * Whether a single variable holds a value. Deliberately not the same
   * question as validateConfig's - callers use this to guard one lookup, not
   * to decide whether a whole feature is live.
   */
  public static isFeatureEnabled(envKey: keyof FeatureBotEnvironment): boolean {
    const value = process.env[envKey];
    return !!(value && value.trim() !== "");
  }

  public static logFeatureDisabled(
    feature: string,
    envKey: keyof FeatureBotEnvironment,
  ): void {
    warn(`⚠️  ${feature} disabled: ${envKey} not configured`);
  }
}
