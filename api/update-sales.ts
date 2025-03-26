import { main } from "../src";

export default async function handler(req: any, res: any) {
  try {
    // Проверяем, что запрос пришел от Vercel Cron
    const isVercelCron = req.headers["x-vercel-cron"] === "1";

    if (!isVercelCron) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await main();
    res.status(200).json({ message: "Данные успешно обновлены" });
  } catch (error) {
    console.error("Ошибка при обновлении данных:", error);
    res.status(500).json({ error: "Ошибка при обновлении данных" });
  }
}
