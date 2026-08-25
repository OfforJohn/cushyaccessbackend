export const MAX_BIRTHDAY_UPDATES_PER_YEAR = 1;

export const getLagosCalendarYear = (date = new Date()) =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
    }).format(date),
  );

export const getBirthdayUpdatesRemaining = (
  updateYear?: number | null,
  updateCount?: number | null,
  now = new Date(),
) => {
  const used =
    updateYear === getLagosCalendarYear(now) ? Number(updateCount || 0) : 0;
  return Math.max(0, MAX_BIRTHDAY_UPDATES_PER_YEAR - used);
};
