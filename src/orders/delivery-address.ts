const normalizeAddress = (value?: string | null): string =>
  (value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const includesAddress = (value: string, candidate: string): boolean => {
  const comparable = (input: string) =>
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const normalizedValue = comparable(value);
  const normalizedCandidate = comparable(candidate);
  return Boolean(
    normalizedCandidate &&
    ` ${normalizedValue} `.includes(` ${normalizedCandidate} `),
  );
};

/**
 * Combines a precise house/landmark instruction with the selected saved map
 * location without duplicating either value when one already contains the
 * other.
 */
export const composeDeliveryAddress = (
  selectedLocation?: string | null,
  houseDetails?: string | null,
): string => {
  const selected = normalizeAddress(selectedLocation);
  const details = normalizeAddress(houseDetails);
  if (!selected) return details;
  if (!details) return selected;

  if (includesAddress(selected, details)) return selected;
  if (includesAddress(details, selected)) return details;
  return `${details}, ${selected}`;
};
