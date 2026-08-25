export const formatDeliveryDate = (durationOrDate: string | Date): string => {
  let date: Date;
  let isDuration = false;

  if (typeof durationOrDate === 'string') {
    const input = durationOrDate.trim().toLowerCase();
    const now = new Date();

    const durationPattern = /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/g;
    const matches = [...input.matchAll(durationPattern)];

    if (matches.length > 0) {
      isDuration = true;

      for (const match of matches) {
        const value = parseInt(match[1], 10);
        const unit = match[2];

        if (isNaN(value)) continue;

        switch (true) {
          case /s(ec(ond)?s?)?/.test(unit):
            now.setSeconds(now.getSeconds() + value);
            break;
          case /m(in(ute)?s?)?/.test(unit):
            now.setMinutes(now.getMinutes() + value);
            break;
          case /h(ou)?rs?/.test(unit):
            now.setHours(now.getHours() + value);
            break;
          case /d(ay)?s?/.test(unit):
            now.setDate(now.getDate() + value);
            break;
        }
      }

      date = now;
    } else {
      date = new Date(durationOrDate);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid duration or date format');
      }
    }
  } else {
    date = durationOrDate;
  }

  if (isDuration) {
    return date.toISOString();
  }

  const day = date.getDate();
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  const ordinalSuffix = (n: number) => {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  const formattedHours = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedMinutes = minutes.toString().padStart(2, '0');

  return `${day}${ordinalSuffix(day)}, ${month} ${year} ${formattedHours}:${formattedMinutes}${ampm}`;
};