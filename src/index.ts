require("dotenv").config();

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fetch = require("node-fetch");
import { DateTime } from "luxon";
import { fetchInventoryData, updateInventorySheet } from "./inventory";
import { isWithinSchedule, getNextRunTime, formatDateTime } from "./schedule";

interface LoyverseReceipt {
  receipt_date: string;
  receipt_number: string;
  receipt_type: string;
  cancelled_at: string | null;
  line_items: Array<{
    item_id: string;
    item_name: string;
    variant_name: string | null;
    category: string;
    quantity: number;
    price: number;
    total_money: {
      amount: number;
    };
    total_discount: number;
    sku: string;
  }>;
  payments: Array<{
    type: string;
    name: string;
  }>;
  employee_name?: string;
  customer_phone_number?: string;
}

interface SheetRow {
  "Дата и время": string;
  "ID чека": string;
  Статус: string;
  Артикул: string;
  Товар: string;
  Категория: string;
  "Кол-во": number;
  "Цена за ед.": number;
  "Сумма со скидкой": number;
  Скидка: number;
  "Способ оплаты": string;
  Сотрудник: string;
  Клиент: string;
  [key: string]: string | number;
}

interface LoyverseItem {
  id: string;
  name: string;
  category_id: string;
}

interface LoyverseCategory {
  id: string;
  name: string;
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

async function fetchItemsAndCategories() {
  console.log("Получаем информацию о товарах и категориях...");

  // Получаем категории
  const categoriesResponse = await fetch(
    "https://api.loyverse.com/v1.0/categories",
    {
      headers: { Authorization: `Bearer ${LOYVERSE_API_KEY}` },
    }
  );

  if (!categoriesResponse.ok) {
    throw new Error(
      `Ошибка получения категорий: ${categoriesResponse.statusText}`
    );
  }

  const categoriesData = await categoriesResponse.json();
  const categories = new Map<string, string>();
  categoriesData.categories.forEach((category: LoyverseCategory) => {
    categories.set(category.id, category.name);
  });

  // Получаем товары
  const items = new Map<string, string>();
  let cursor: string | null = null;

  do {
    const url = new URL("https://api.loyverse.com/v1.0/items");
    if (cursor) {
      url.searchParams.append("cursor", cursor);
    }

    const itemsResponse = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${LOYVERSE_API_KEY}` },
    });

    if (!itemsResponse.ok) {
      throw new Error(`Ошибка получения товаров: ${itemsResponse.statusText}`);
    }

    const itemsData = await itemsResponse.json();
    itemsData.items.forEach((item: LoyverseItem) => {
      const categoryName = categories.get(item.category_id) || "Без категории";
      items.set(item.id, categoryName);
    });

    cursor = itemsData.cursor;
  } while (cursor);

  return items;
}

async function fetchSalesData(): Promise<LoyverseReceipt[]> {
  console.log("Начинаем получение данных из Loyverse API...");

  // Получаем информацию о товарах и их категориях
  const itemCategories = await fetchItemsAndCategories();

  // Получаем даты для фильтрации
  const now = new Date();
  const startOf2025 = new Date("2025-01-01T00:00:00Z");

  // Форматируем даты в ISO формат
  const startDate = startOf2025.toISOString();
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

      if (!response.ok) {
        throw new Error(`Ошибка API Loyverse: ${response.statusText}`);
      }

      const data = await response.json();
      const receipts = data.receipts as LoyverseReceipt[];

      // Добавляем категории к чекам
      receipts.forEach((receipt) => {
        receipt.line_items.forEach((item) => {
          item.category = itemCategories.get(item.item_id) || "Без категории";
        });
      });

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

async function updateSheet(
  doc: typeof GoogleSpreadsheet,
  salesData: LoyverseReceipt[]
) {
  console.log("\nСтатистика:");
  console.log(`Всего чеков: ${salesData.length}`);
  console.log(
    `Всего товаров: ${salesData.reduce(
      (sum, receipt) => sum + receipt.line_items.length,
      0
    )}`
  );

  console.log("\nНачинаем запись в Google Sheets...");
  try {
    // Ищем лист "Sales"
    const sheet = doc.sheetsByTitle["Sales"];
    if (!sheet) {
      throw new Error('Лист "Sales" не найден');
    }

    // Очищаем лист перед записью новых данных
    await sheet.clear();

    // Определяем заголовки столбцов
    const headers = [
      "Дата и время",
      "ID чека",
      "Артикул",
      "Товар",
      "Категория",
      "Кол-во",
      "Цена за ед.",
      "Сумма со скидкой",
      "Скидка",
      "Способ оплаты",
      "Сотрудник",
      "Клиент",
      "Статус",
    ];

    // Устанавливаем заголовки
    await sheet.setHeaderRow(headers);

    const rows: SheetRow[] = salesData.flatMap((receipt) =>
      receipt.line_items.map((item) => {
        const totalBeforeDiscount = item.quantity * item.price;
        return {
          "Дата и время": receipt.receipt_date,
          "ID чека": receipt.receipt_number,
          Артикул: item.sku,
          Товар: item.variant_name
            ? `${item.item_name} (${item.variant_name})`
            : item.item_name,
          Категория: item.category || "Без категории",
          "Кол-во": item.quantity,
          "Цена за ед.": item.price,
          "Сумма со скидкой": totalBeforeDiscount - item.total_discount,
          Скидка: item.total_discount,
          "Способ оплаты": receipt.payments.map((p) => p.name).join(", "),
          Сотрудник: receipt.employee_name || "Не указан",
          Клиент: receipt.customer_phone_number || "-",
          Статус: receipt.cancelled_at || "-",
        };
      })
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
    // Проверяем, находимся ли мы в рабочем времени
    if (!isWithinSchedule()) {
      const nextRun = getNextRunTime();
      console.log(
        `Вне рабочего времени. Следующий запуск: ${formatDateTime(nextRun)}`
      );
      return;
    }

    console.log("Запуск скрипта...");
    console.log(
      `Текущее время (Бангкок): ${formatDateTime(
        DateTime.now().setZone("Asia/Bangkok")
      )}`
    );

    // Инициализируем подключение к Google Sheets
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (GOOGLE_PRIVATE_KEY as string).replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID as string, serviceAccountAuth);
    await doc.loadInfo();
    console.log("Таблица загружена:", doc.title);

    // Получаем и обрабатываем данные о продажах
    const salesData = await fetchSalesData();
    await updateSheet(doc, salesData);

    // Получаем и обрабатываем данные об остатках
    const inventoryData = await fetchInventoryData(LOYVERSE_API_KEY as string);
    await updateInventorySheet(doc, inventoryData);

    console.log("\nСкрипт успешно завершен");
    console.log(`Следующий запуск: ${formatDateTime(getNextRunTime())}`);
  } catch (error) {
    console.error("Ошибка при обработке данных:", error);
    // В случае ошибки пробуем еще раз через 5 минут
    const retryTime = DateTime.now().plus({ minutes: 5 });
    console.log(
      `Повторная попытка через 5 минут: ${formatDateTime(retryTime)}`
    );
    setTimeout(main, 5 * 60 * 1000);
  }
}

// Экспортируем main для использования в API endpoint
export { main };

// Запускаем main() если скрипт запущен напрямую
if (require.main === module) {
  main().catch(console.error);
}
