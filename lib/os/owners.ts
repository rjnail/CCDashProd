const FICTIONAL_OWNER_NAMES = new Set(["alex", "jordan", "morgan"]);

export const MEMBERSHIP_EMPTY_NOTE = "Team members appear after memberships are stored.";

export type OwnerCandidate = { id: string; name: string };

export function isFictionalOwnerName(name: string): boolean {
  return FICTIONAL_OWNER_NAMES.has(name.trim().toLowerCase().replace(/\s+/g, " "));
}

export function eligibleOwners(members: readonly OwnerCandidate[]): OwnerCandidate[] {
  const seen = new Set<string>();
  const options: OwnerCandidate[] = [];
  for (const member of members) {
    const id = member.id.trim();
    const name = member.name.trim().replace(/\s+/g, " ");
    if (!id || !name || seen.has(id) || isFictionalOwnerName(name)) continue;
    seen.add(id);
    options.push({ id, name });
  }
  return options;
}

export function ownerChoice(
  ownerUserId: string | null | undefined,
  ownerName: string,
  members: readonly OwnerCandidate[]
): string {
  const options = eligibleOwners(members);
  const id = ownerUserId?.trim() ?? "";
  if (id && options.some((member) => member.id === id)) return id;
  const named = ownerName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!named || isFictionalOwnerName(named)) return "";
  const matches = options.filter((member) => member.name.toLowerCase() === named);
  return matches.length === 1 ? matches[0].id : "";
}
