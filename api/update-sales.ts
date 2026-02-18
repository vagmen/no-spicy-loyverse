import type { VercelRequest, VercelResponse } from "@vercel/node";

const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO; // например "username/no-spicy-loyverse"
const TRIGGER_SECRET = process.env.TRIGGER_SECRET; // опционально, для защиты эндпоинта

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Проверка секрета (если задан)
    if (TRIGGER_SECRET) {
      const secret = req.query.secret;
      if (secret !== TRIGGER_SECRET) {
        return res.status(403).json({ error: "Неверный секрет" });
      }
    }

    if (!GITHUB_PAT || !GITHUB_REPO) {
      return res.status(500).json({
        error: "Не заданы переменные окружения GITHUB_PAT или GITHUB_REPO",
      });
    }

    console.log(`Запуск workflow для ${GITHUB_REPO}...`);

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/hourly-update.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "no-spicy-loyverse",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (response.status === 204) {
      return res.status(200).json({
        message: "✅ Workflow запущен успешно!",
        repo: GITHUB_REPO,
        timestamp: new Date().toISOString(),
      });
    }

    const errorText = await response.text();
    console.error(`GitHub API ошибка: ${response.status}`, errorText);

    return res.status(response.status).json({
      error: "Ошибка запуска workflow",
      status: response.status,
      details: errorText,
    });
  } catch (error: any) {
    console.error("Ошибка:", error);
    return res.status(500).json({
      error: "Ошибка при запуске workflow",
      details: error.message,
    });
  }
}
