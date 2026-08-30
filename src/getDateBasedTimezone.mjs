/*
 *
 * helper: `getDateBasedTimezone`.
 *
 */
const getDateBasedTimezone = () => {
  const date = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const { day, month, year, hour, minute, second, dayPeriod } = formatter
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const dateString = `${day}-${month}-${year}`;
  const time = `${hour}:${minute}:${second} ${dayPeriod.toLowerCase()}`;

  return {
    dateString,
    time,
    dateTime: `${dateString} ${time}`,
  };
};

export default getDateBasedTimezone;
