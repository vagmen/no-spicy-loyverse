import { main } from "../src";

export default async function handler(req: any, res: any) {
  try {
    // Проверяем, что запрос пришел от cron-job.org или локально
    const userAgent = req.headers["user-agent"] || "";
    const isCronJob =
      userAgent.includes("Cron-Job.org") ||
      req.headers["x-vercel-cron"] === "1";

    if (!isCronJob && process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await main();
    return res.status(200).json({ message: "Данные успешно обновлены" });
  } catch (error: any) {
    console.error("Ошибка при обновлении данных:", error);
    return res.status(500).json({
      error: "Ошибка при обновлении данных",
      details: error.message,
    });
  }
}
