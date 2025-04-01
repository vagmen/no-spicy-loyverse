import { DateTime } from "luxon";

const BANGKOK_TIMEZONE = "Asia/Bangkok";

export function isWithinSchedule(): boolean {
  const now = DateTime.now().setZone(BANGKOK_TIMEZONE);
  const hour = now.hour;

  // С 13:00 до 01:00 по бангкокскому времени
  return hour >= 13 || hour < 1;
}

export function getNextRunTime(): DateTime {
  const now = DateTime.now().setZone(BANGKOK_TIMEZONE);
  const hour = now.hour;

  if (hour >= 13 || hour < 1) {
    // Если мы в рабочем времени, следующий запуск через час
    return now.plus({ hours: 1 }).startOf("hour");
  } else {
    // Если мы вне рабочего времени, следующий запуск в 13:00
    return now.set({ hour: 13, minute: 0, second: 0, millisecond: 0 });
  }
}

export function formatDateTime(date: DateTime): string {
  return date.toFormat("dd.MM.yyyy HH:mm:ss ZZZZ");
}
