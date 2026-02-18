import { GoogleSpreadsheet } from "google-spreadsheet";
import { DateTime } from "luxon";

const BANGKOK_TIMEZONE = "Asia/Bangkok";
const LOG_SHEET_NAME = "Logs";

interface RunLog {
  timestamp: string;
  trigger: string;
  status: "✅ Успех" | "❌ Ошибка";
  salesCount: number;
  salesItemsCount: number;
  inventoryCount: number;
  periodFrom: string;
  periodTo: string;
  durationSec: number;
  error: string;
}

const LOG_HEADERS = [
  "Дата и время",
  "Триггер",
  "Статус",
  "Чеков",
  "Товаров в чеках",
  "Позиций остатков",
  "Период с",
  "Период по",
  "Длительность (сек)",
  "Ошибка",
];

async function getOrCreateLogSheet(doc: GoogleSpreadsheet) {
  let sheet = doc.sheetsByTitle[LOG_SHEET_NAME];
  if (!sheet) {
    sheet = await doc.addSheet({ title: LOG_SHEET_NAME });
    await sheet.setHeaderRow(LOG_HEADERS);
    console.log(`Создан лист '${LOG_SHEET_NAME}'`);
  }
  return sheet;
}

function detectTrigger(): string {
  // GitHub Actions устанавливает GITHUB_EVENT_NAME
  const eventName = process.env.GITHUB_EVENT_NAME;

  if (eventName === "schedule") return "⏰ Авто (cron)";
  if (eventName === "workflow_dispatch") return "🔗 Вручную";
  if (eventName === "repository_dispatch") return "🌐 API";

  // Если переменной нет — скорее всего запуск локально или через другой триггер
  if (eventName) return `📋 ${eventName}`;

  return "🖥️ Локально";
}

export class RunLogger {
  private startTime: DateTime;
  private trigger: string;

  public salesCount = 0;
  public salesItemsCount = 0;
  public inventoryCount = 0;
  public periodFrom = "";
  public periodTo = "";

  constructor() {
    this.startTime = DateTime.now().setZone(BANGKOK_TIMEZONE);
    this.trigger = detectTrigger();
  }

  async logSuccess(doc: GoogleSpreadsheet): Promise<void> {
    const log = this.buildLog("✅ Успех", "");
    await this.writeLog(doc, log);
  }

  async logError(doc: GoogleSpreadsheet, error: Error | string): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const log = this.buildLog("❌ Ошибка", errorMessage);
    await this.writeLog(doc, log);
  }

  private buildLog(
    status: "✅ Успех" | "❌ Ошибка",
    error: string
  ): RunLog {
    const now = DateTime.now().setZone(BANGKOK_TIMEZONE);
    const durationSec = now.diff(this.startTime, "seconds").seconds;

    return {
      timestamp: this.startTime.toFormat("dd.MM.yyyy HH:mm:ss"),
      trigger: this.trigger,
      status,
      salesCount: this.salesCount,
      salesItemsCount: this.salesItemsCount,
      inventoryCount: this.inventoryCount,
      periodFrom: this.periodFrom,
      periodTo: this.periodTo,
      durationSec: Math.round(durationSec),
      error: error || "-",
    };
  }

  private async writeLog(
    doc: GoogleSpreadsheet,
    log: RunLog
  ): Promise<void> {
    try {
      const sheet = await getOrCreateLogSheet(doc);

      await sheet.addRow({
        "Дата и время": log.timestamp,
        Триггер: log.trigger,
        Статус: log.status,
        Чеков: log.salesCount,
        "Товаров в чеках": log.salesItemsCount,
        "Позиций остатков": log.inventoryCount,
        "Период с": log.periodFrom,
        "Период по": log.periodTo,
        "Длительность (сек)": log.durationSec,
        Ошибка: log.error,
      });

      console.log(`📝 Лог записан: ${log.status} (${log.durationSec} сек)`);
    } catch (logError) {
      // Ошибка логирования не должна ломать основной процесс
      console.error("Ошибка записи лога:", logError);
    }
  }
}
