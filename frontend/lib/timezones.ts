/**
 * Timezone options offered in the UI.
 *
 * The backend accepts any IANA zone name, so this list is a convenience
 * shortlist rather than a constraint. The browser's detected zone is added at
 * runtime when it is not already present, so nobody is forced to pick a zone
 * that is not theirs.
 */

export interface TimezoneOption {
  value: string;
  label: string;
  offset: string;
}

export interface TimezoneGroup {
  group: string;
  items: TimezoneOption[];
}

export const TIMEZONE_GROUPS: TimezoneGroup[] = [
  {
    group: "Asia",
    items: [
      { value: "Asia/Phnom_Penh", label: "Indochina Time (Phnom Penh, Bangkok)", offset: "+07:00" },
      { value: "Asia/Tokyo", label: "Japan Standard Time (Tokyo)", offset: "+09:00" },
      { value: "Asia/Kolkata", label: "India Standard Time (New Delhi)", offset: "+05:30" },
      { value: "Asia/Shanghai", label: "China Standard Time (Shanghai)", offset: "+08:00" },
    ],
  },
  {
    group: "Americas",
    items: [
      { value: "America/New_York", label: "Eastern Time (New York)", offset: "-05:00" },
      { value: "America/Chicago", label: "Central Time (Chicago)", offset: "-06:00" },
      { value: "America/Denver", label: "Mountain Time (Denver)", offset: "-07:00" },
      { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)", offset: "-08:00" },
    ],
  },
  {
    group: "Europe",
    items: [
      { value: "Europe/London", label: "GMT / British Time (London)", offset: "+00:00" },
      { value: "Europe/Paris", label: "Central European Time (Paris)", offset: "+01:00" },
    ],
  },
  {
    group: "Oceania",
    items: [
      { value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)", offset: "+10:00" },
    ],
  },
];

export const ALL_TIMEZONES: TimezoneOption[] = TIMEZONE_GROUPS.flatMap((group) => group.items);

/** The browser's IANA zone, falling back to UTC where it is unavailable. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The shortlist plus `zone`, so a value loaded from the server always has a
 * matching option even when it is not one of the presets.
 */
export function withTimezone(zone: string | null | undefined): TimezoneGroup[] {
  if (!zone || ALL_TIMEZONES.some((option) => option.value === zone)) {
    return TIMEZONE_GROUPS;
  }
  return [
    { group: "Detected", items: [{ value: zone, label: zone, offset: formatOffset(zone) }] },
    ...TIMEZONE_GROUPS,
  ];
}

/** Current UTC offset for a zone, formatted as ±HH:MM. */
export function formatOffset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    // Intl renders UTC itself as the bare string "GMT".
    return name.replace("GMT", "") || "+00:00";
  } catch {
    return "—";
  }
}
