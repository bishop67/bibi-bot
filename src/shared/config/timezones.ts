// Curated set of well-known city/zone pairs shown by default and matched
// against for autocomplete. Users can also type any raw IANA zone id
// (e.g. "America/Chicago") directly - see isValidTimeZone below.
export const TIMEZONE_CHOICES: { label: string; zone: string }[] = [
  { label: "Los Angeles", zone: "America/Los_Angeles" },
  { label: "Denver", zone: "America/Denver" },
  { label: "Chicago", zone: "America/Chicago" },
  { label: "New York", zone: "America/New_York" },
  { label: "Toronto", zone: "America/Toronto" },
  { label: "Mexico City", zone: "America/Mexico_City" },
  { label: "São Paulo", zone: "America/Sao_Paulo" },
  { label: "Buenos Aires", zone: "America/Argentina/Buenos_Aires" },
  { label: "London", zone: "Europe/London" },
  { label: "Lisbon", zone: "Europe/Lisbon" },
  { label: "Paris", zone: "Europe/Paris" },
  { label: "Berlin", zone: "Europe/Berlin" },
  { label: "Madrid", zone: "Europe/Madrid" },
  { label: "Rome", zone: "Europe/Rome" },
  { label: "Athens", zone: "Europe/Athens" },
  { label: "Moscow", zone: "Europe/Moscow" },
  { label: "Istanbul", zone: "Europe/Istanbul" },
  { label: "Cairo", zone: "Africa/Cairo" },
  { label: "Lagos", zone: "Africa/Lagos" },
  { label: "Johannesburg", zone: "Africa/Johannesburg" },
  { label: "Dubai", zone: "Asia/Dubai" },
  { label: "Karachi", zone: "Asia/Karachi" },
  { label: "Mumbai", zone: "Asia/Kolkata" },
  { label: "Dhaka", zone: "Asia/Dhaka" },
  { label: "Bangkok", zone: "Asia/Bangkok" },
  { label: "Jakarta", zone: "Asia/Jakarta" },
  { label: "Singapore", zone: "Asia/Singapore" },
  { label: "Hong Kong", zone: "Asia/Hong_Kong" },
  { label: "Shanghai", zone: "Asia/Shanghai" },
  { label: "Seoul", zone: "Asia/Seoul" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
  { label: "Perth", zone: "Australia/Perth" },
  { label: "Sydney", zone: "Australia/Sydney" },
  { label: "Auckland", zone: "Pacific/Auckland" },
  { label: "Honolulu", zone: "Pacific/Honolulu" },
];

// The default set shown by /time with no argument - kept short so the
// embed stays readable, roughly spread across the globe.
export const DEFAULT_WORLD_CLOCK_ZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

let cachedValidZones: Set<string> | null = null;
function getValidZones(): Set<string> {
  if (!cachedValidZones) {
    cachedValidZones = new Set(Intl.supportedValuesOf("timeZone"));
  }
  return cachedValidZones;
}

export function isValidTimeZone(zone: string): boolean {
  return getValidZones().has(zone);
}

// Resolve free-text input to an IANA zone: exact zone id, a curated
// city label (case-insensitive, partial match), or null if nothing matches.
export function resolveTimeZone(input: string): string | null {
  const trimmed = input.trim();

  if (isValidTimeZone(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  const exactLabel = TIMEZONE_CHOICES.find(
    (c) => c.label.toLowerCase() === lower,
  );
  if (exactLabel) return exactLabel.zone;

  const partialLabel = TIMEZONE_CHOICES.find((c) =>
    c.label.toLowerCase().includes(lower),
  );
  if (partialLabel) return partialLabel.zone;

  return null;
}

export function formatZoneTime(zone: string, date: Date = new Date()) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);

  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");

  return {
    time,
    date: dateStr,
    offset: offsetPart?.value ?? "",
  };
}