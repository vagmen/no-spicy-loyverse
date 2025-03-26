require("dotenv").config();

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fetch = require("node-fetch");

interface LoyverseReceipt {
  receipt_date: string;
  receipt_number: string;
  line_items: Array<{
    item_name: string;
    category: string;
    quantity: number;
    total_price: number;
  }>;
  payments: Array<{
    type: string;
  }>;
  employee_name?: string;
  customer_phone_number?: string;
}

interface SheetRow {
  "Дата и время": string;
  "ID чека": string;
  Товар: string;
  Категория: string;
  "Кол-во": number;
  Сумма: number;
  "Способ оплаты": string;
  Сотрудник: string;
  Клиент: string;
  [key: string]: string | number;
}

const SHEET_ID = process.env.SHEET_ID;
const LOYVERSE_API_KEY = process.env.LOYVERSE_API_KEY;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

if (
  !SHEET_ID ||
  !LOYVERSE_API_KEY ||
  !GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  !GOOGLE_PRIVATE_KEY
) {
  throw new Error(
    "Необходимо указать все переменные окружения: SHEET_ID, LOYVERSE_API_KEY, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY"
  );
}

async function fetchSalesData(): Promise<LoyverseReceipt[]> {
  console.log("Начинаем получение данных из Loyverse API...");

  // Получаем даты для фильтрации
  const now = new Date();
  const lastMonth = new Date(now);
  lastMonth.setMonth(now.getMonth() - 1);

  // Форматируем даты в ISO формат
  const startDate = lastMonth.toISOString();
  const endDate = now.toISOString();

  console.log("Период запроса:", { с: startDate, по: endDate });

  let allReceipts: LoyverseReceipt[] = [];
  let cursor: string | null = null;
  let pageCount = 0;

  try {
    do {
      pageCount++;
      console.log(`Загрузка страницы ${pageCount}...`);

      const url = new URL("https://api.loyverse.com/v1.0/receipts");
      url.searchParams.append("created_at_min", startDate);
      url.searchParams.append("created_at_max", endDate);
      url.searchParams.append("limit", "250"); // Максимальный размер страницы
      if (cursor) {
        url.searchParams.append("cursor", cursor);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${LOYVERSE_API_KEY}` },
      });

      console.log("Статус ответа:", response.status);

      if (!response.ok) {
        throw new Error(`Ошибка API Loyverse: ${response.statusText}`);
      }

      const data = await response.json();
      const receipts = data.receipts as LoyverseReceipt[];
      cursor = data.cursor;

      console.log(`Получено ${receipts.length} чеков на странице ${pageCount}`);
      allReceipts = allReceipts.concat(receipts);

      if (cursor) {
        console.log("Есть ещё страницы, продолжаем загрузку...");
      }
    } while (cursor);

    console.log(
      `\nЗагрузка завершена. Всего получено ${allReceipts.length} чеков за ${pageCount} страниц`
    );
    return allReceipts;
  } catch (error) {
    console.error("Ошибка при запросе к API:", error);
    throw error;
  }
}

async function updateSheet(salesData: LoyverseReceipt[]) {
  console.log("\nСтатистика:");
  console.log(`Всего чеков: ${salesData.length}`);
  console.log(
    `Всего товаров: ${salesData.reduce(
      (sum, receipt) => sum + receipt.line_items.length,
      0
    )}`
  );
  console.log(
    `Общая сумма: ${salesData.reduce(
      (sum, receipt) =>
        sum +
        receipt.line_items.reduce(
          (itemSum, item) => itemSum + item.total_price,
          0
        ),
      0
    )}`
  );

  console.log("\nНачинаем запись в Google Sheets...");
  try {
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (GOOGLE_PRIVATE_KEY as string).replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID as string, serviceAccountAuth);
    await doc.loadInfo();
    console.log("Таблица загружена:", doc.title);

    const sheet = doc.sheetsByIndex[0];
    console.log("Лист:", sheet.title);

    // Определяем заголовки столбцов
    const headers = [
      "Дата и время",
      "ID чека",
      "Товар",
      "Категория",
      "Кол-во",
      "Сумма",
      "Способ оплаты",
      "Сотрудник",
      "Клиент",
    ];

    // Устанавливаем заголовки
    await sheet.setHeaderRow(headers);
    console.log("Заголовки установлены");

    const rows: SheetRow[] = salesData.flatMap((receipt) =>
      receipt.line_items.map((item) => ({
        "Дата и время": receipt.receipt_date,
        "ID чека": receipt.receipt_number,
        Товар: item.item_name,
        Категория: item.category || "Без категории",
        "Кол-во": item.quantity,
        Сумма: item.total_price,
        "Способ оплаты": receipt.payments.map((p) => p.type).join(", "),
        Сотрудник: receipt.employee_name || "Не указан",
        Клиент: receipt.customer_phone_number || "-",
      }))
    );

    console.log(`Подготовлено ${rows.length} строк для записи`);
    await sheet.addRows(rows);
    console.log("Данные успешно записаны в таблицу");
  } catch (error) {
    console.error("Ошибка при записи в таблицу:", error);
    throw error;
  }
}

async function main() {
  try {
    console.log("Запуск скрипта...");
    const salesData = await fetchSalesData();
    await updateSheet(salesData);
    console.log("\nСкрипт успешно завершен");
  } catch (error) {
    console.error("Ошибка при обработке данных:", error);
    throw error;
  }
}

// Экспортируем main для использования в API endpoint
export { main };

// Запускаем main() если скрипт запущен напрямую
if (require.main === module) {
  main().catch(console.error);
}
