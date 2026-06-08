import { AuthorizationError } from "./errors";

const LOYVERSE_REQUEST_TIMEOUT_MS = 30_000;

interface FetchLoyverseJsonOptions {
  apiKey: string;
  context: string;
  url: string | URL;
}

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 200);
  } catch {
    return "";
  }
}

function isTimeoutError(error: unknown): boolean {
  const err = error as Error;
  return (
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    err.message.includes("aborted due to timeout")
  );
}

function createTimeoutError(context: string): Error {
  return new Error(
    `Таймаут Loyverse API (${context}) после ${
      LOYVERSE_REQUEST_TIMEOUT_MS / 1000
    } сек`,
  );
}

export async function fetchLoyverseJson<T>({
  apiKey,
  context,
  url,
}: FetchLoyverseJsonOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LOYVERSE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw createTimeoutError(context);
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthorizationError(
        `Ошибка авторизации: неверный или истекший API ключ. Статус: ${response.status}`,
      );
    }

    const details = await readErrorSnippet(response);
    throw new Error(
      `Ошибка Loyverse API (${context}): HTTP ${response.status} ${
        response.statusText || ""
      }${details ? ` - ${details}` : ""}`,
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (isTimeoutError(error)) {
      throw createTimeoutError(context);
    }
    throw error;
  }

  if (!body.trim()) {
    throw new Error(`Пустой ответ Loyverse API (${context}): HTTP ${response.status}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `Некорректный JSON от Loyverse API (${context}): HTTP ${
        response.status
      }, content-type ${response.headers.get("content-type") || "unknown"}, длина ${
        body.length
      }`,
    );
  }
}
