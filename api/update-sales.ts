import { main } from "../src";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log("API endpoint вызван");
    await main();
    console.log("Обработка завершена успешно");
    return res.status(200).json({ message: "Данные успешно обновлены" });
  } catch (error: any) {
    console.error("Ошибка:", error);
    return res.status(500).json({
      error: "Ошибка при обновлении данных",
      details: error.message,
    });
  }
}
