import { GoogleSpreadsheet } from "google-spreadsheet";
import { isWithinSchedule, getNextRunTime, formatDateTime } from "./schedule";

interface LoyverseStore {
  id: string;
  name: string;
  store_id: string;
  pricing_type: string;
  price: number;
  available_for_sale: boolean;
  optimal_stock: number | null;
  low_stock: number | null;
  stock?: number;
}

interface LoyverseVariant {
  variant_id: string;
  item_id: string;
  sku: string;
  reference_variant_id: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  barcode: string | null;
  cost: number;
  purchase_cost: number;
  default_pricing_type: string;
  default_price: number;
  stores: LoyverseStore[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface LoyverseItem {
  id: string;
  handle: string;
  item_name: string;
  reference_id: string | null;
  category_id: string | null;
  track_stock: boolean;
  sold_by_weight: boolean;
  is_composite: boolean;
  use_production: boolean;
  primary_supplier_id: string | null;
  variants: LoyverseVariant[];
  created_at: string;
  updated_at: string;
}

interface LoyverseCategory {
  id: string;
  handle: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

interface LoyverseSupplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

interface InventoryItem {
  sku: string;
  itemName: string;
  variantName: string | null;
  categoryName: string;
  stock: number;
  cost: number;
  price: number;
  totalCost: number;
  totalPrice: number;
  inStock: boolean;
  barcode: string | null;
  reference: string | null;
  trackStock: boolean;
  lastUpdated: string;
  supplier: string | null;
}

export async function fetchInventoryData(
  apiKey: string
): Promise<InventoryItem[]> {
  // Проверяем, находимся ли мы в рабочем времени
  if (!isWithinSchedule()) {
    const nextRun = getNextRunTime();
    console.log(
      `Вне рабочего времени. Следующий запуск обновления остатков: ${formatDateTime(
        nextRun
      )}`
    );
    return [];
  }

  console.log("Получаем данные об остатках...");
  const inventory: InventoryItem[] = [];

  // Получаем список поставщиков
  console.log("Загрузка списка поставщиков...");
  const suppliersResponse = await fetch(
    "https://api.loyverse.com/v1.0/suppliers",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!suppliersResponse.ok) {
    throw new Error(
      `Ошибка получения списка поставщиков: ${suppliersResponse.statusText}`
    );
  }

  const suppliersData = await suppliersResponse.json();
  const suppliers = new Map<string, string>();
  suppliersData.suppliers.forEach((supplier: LoyverseSupplier) => {
    suppliers.set(supplier.id, supplier.name);
  });
  console.log(`Загружено ${suppliers.size} поставщиков`);

  // Получаем список магазинов
  console.log("Загрузка списка магазинов...");
  const storesResponse = await fetch("https://api.loyverse.com/v1.0/stores", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!storesResponse.ok) {
    throw new Error(
      `Ошибка получения списка магазинов: ${storesResponse.statusText}`
    );
  }

  const storesData = await storesResponse.json();
  const stores = storesData.stores;
  console.log(`Загружено ${stores.length} магазинов`);

  // Получаем категории
  console.log("\nЗагрузка категорий...");
  const categories = new Map<string, string>();
  const categoriesResponse = await fetch(
    "https://api.loyverse.com/v1.0/categories",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!categoriesResponse.ok) {
    throw new Error(
      `Ошибка получения категорий: ${categoriesResponse.statusText}`
    );
  }

  const categoriesData = await categoriesResponse.json();
  categoriesData.categories.forEach((category: LoyverseCategory) => {
    categories.set(category.id, category.name);
  });
  console.log(`Загружено ${categories.size} категорий`);

  // Получаем остатки для каждого магазина
  console.log("\nЗагрузка остатков...");
  const stocks = new Map<string, number>();

  for (const store of stores) {
    let stockCursor: string | null = null;
    do {
      const stockUrl = new URL("https://api.loyverse.com/v1.0/inventory");
      stockUrl.searchParams.append("store_id", store.id);
      if (stockCursor) {
        stockUrl.searchParams.append("cursor", stockCursor);
      }

      const stockResponse = await fetch(stockUrl.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!stockResponse.ok) {
        throw new Error(
          `Ошибка получения остатков для магазина ${store.name}: ${stockResponse.statusText}`
        );
      }

      const stockData = await stockResponse.json();

      // Добавляем отладочный вывод для первого магазина на первой странице
      if (store === stores[0] && !stockCursor) {
        console.log("\nПример данных остатков:");
        console.log(JSON.stringify(stockData, null, 2));
      }

      // Проверяем структуру данных перед обработкой
      if (!stockData.inventory_levels) {
        console.log("Неожиданная структура данных остатков:", stockData);
        continue;
      }

      // Сохраняем остатки в Map для быстрого доступа
      stockData.inventory_levels.forEach((item: any) => {
        stocks.set(item.variant_id, item.in_stock);
      });

      stockCursor = stockData.cursor;
      console.log(
        `Загружено ${
          stockData.inventory_levels?.length || 0
        } остатков для магазина ${store.name}`
      );
    } while (stockCursor);
  }

  // Получаем товары
  console.log("\nЗагрузка товаров...");
  let cursor: string | null = null;
  let pageCount = 0;
  let totalItems = 0;

  do {
    pageCount++;
    const url = new URL("https://api.loyverse.com/v1.0/items");
    if (cursor) {
      url.searchParams.append("cursor", cursor);
    }

    const itemsResponse = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!itemsResponse.ok) {
      throw new Error(`Ошибка получения товаров: ${itemsResponse.statusText}`);
    }

    const data = await itemsResponse.json();

    // Добавляем отладочный вывод для первого товара
    if (pageCount === 1 && data.items.length > 0) {
      console.log("\nПример данных первого товара:");
      console.log(JSON.stringify(data.items[0], null, 2));
      if (data.items[0].variants && data.items[0].variants.length > 0) {
        console.log("\nПример первого варианта:");
        console.log(JSON.stringify(data.items[0].variants[0], null, 2));
      }
    }

    // Обрабатываем каждый товар
    data.items.forEach((item: LoyverseItem) => {
      const categoryName = item.category_id
        ? categories.get(item.category_id)
        : "Без категории";

      if (item.variants && item.variants.length > 0) {
        item.variants.forEach((variant: LoyverseVariant) => {
          const store = variant.stores[0];
          if (!store) return;

          // Получаем остаток из Map
          const stock = stocks.get(variant.variant_id) || 0;

          totalItems++;
          inventory.push({
            sku: variant.sku || item.handle,
            itemName: item.item_name,
            variantName: variant.option1_value || null,
            categoryName: categoryName || "Без категории",
            stock: stock,
            cost: variant.cost || 0,
            price: store.price || variant.default_price || 0,
            totalCost: stock * (variant.cost || 0),
            totalPrice: stock * (store.price || variant.default_price || 0),
            inStock: store.available_for_sale || false,
            barcode: variant.barcode,
            reference: variant.reference_variant_id,
            trackStock: item.track_stock,
            lastUpdated: item.updated_at,
            supplier: item.primary_supplier_id
              ? suppliers.get(item.primary_supplier_id) ||
                item.primary_supplier_id
              : null,
          });
        });
      } else {
        console.log(`Предупреждение: товар без вариантов: ${item.item_name}`);
      }
    });

    cursor = data.cursor;
    console.log(
      `Обработано ${data.items.length} товаров на странице ${pageCount}`
    );
  } while (cursor);

  console.log(`\nВсего обработано ${totalItems} позиций (с учетом вариантов)`);
  return inventory;
}

export async function updateInventorySheet(
  doc: GoogleSpreadsheet,
  inventory: InventoryItem[]
) {
  console.log("\nОбновляем лист с остатками...");

  // Ищем или создаем лист "Stock"
  let sheet = doc.sheetsByTitle["Stock"];
  if (!sheet) {
    sheet = await doc.addSheet({ title: "Stock" });
    console.log("Создан новый лист 'Stock'");
  }

  // Очищаем лист
  await sheet.clear();
  console.log("Существующий лист очищен");

  // Устанавливаем заголовки
  const headers = [
    "Артикул",
    "Товар",
    "Вариация",
    "Категория",
    "Остаток",
    "Себестоимость",
    "Цена",
    "Общая себестоимость",
    "Общая цена",
    "В наличии",
    "Штрих-код",
    "Референс",
    "Учет остатков",
    "Последнее обновление",
    "Поставщик",
  ];

  // Устанавливаем заголовки
  await sheet.setHeaderRow(headers);
  console.log("Заголовки установлены");

  // Подготавливаем данные для записи
  const rows = inventory.map((item) => ({
    Артикул: item.sku,
    Товар: item.itemName,
    Вариация: item.variantName || "-",
    Категория: item.categoryName,
    Остаток: item.stock,
    Себестоимость: item.cost,
    Цена: item.price,
    "Общая себестоимость": item.totalCost,
    "Общая цена": item.totalPrice,
    "В наличии": item.inStock ? "Да" : "Нет",
    "Штрих-код": item.barcode || "-",
    Референс: item.reference || "-",
    "Учет остатков": item.trackStock ? "Да" : "Нет",
    "Последнее обновление": new Date(item.lastUpdated).toLocaleString("ru-RU"),
    Поставщик: item.supplier || "-",
  }));

  // Записываем данные
  await sheet.addRows(rows);
  console.log(`Записано ${rows.length} строк`);

  if (rows.length === 0) {
    console.log("Нет данных для записи в остатки");
    return;
  }

  // Форматируем числовые колонки
  const numericColumns = [
    "Остаток",
    "Себестоимость",
    "Цена",
    "Общая себестоимость",
    "Общая цена",
  ];
  for (const column of numericColumns) {
    const columnIndex = headers.indexOf(column);
    if (columnIndex !== -1) {
      await sheet.loadCells({
        startRowIndex: 1,
        endRowIndex: rows.length + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      });

      for (let i = 1; i <= rows.length; i++) {
        const cell = sheet.getCell(i, columnIndex);
        cell.numberFormat = { type: "NUMBER", pattern: "#,##0.00" };
      }
    }
  }

  console.log("Форматирование завершено");
}
