type ApiErrorOptions = {
  fieldLabels?: Record<string, string>;
  conflictMessages?: Record<string, string>;
};

export async function parseApiPayload(response: Response): Promise<unknown> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {} as T;
  }

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    throw new Error(
      "The backend returned an HTML error page instead of JSON. Verify backend migrations and restart the API service."
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(trimmed);
  }
}

export function formatApiError(
  payload: unknown,
  fallbackMessage: string,
  options: ApiErrorOptions = {}
) {
  const humanizeFieldMessage = (field: string, message: string) => {
    const normalized = message.trim();
    const conflictMessage = options.conflictMessages?.[field];

    if (conflictMessage && normalized.toLowerCase().includes("already exists")) {
      return conflictMessage;
    }

    const label = options.fieldLabels?.[field] || field.replace(/_/g, " ");
    return `${label}: ${normalized}`;
  };

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }

    const fieldMessages = Object.entries(payload as Record<string, unknown>)
      .flatMap(([field, value]) => {
        if (field === "message") {
          return [];
        }

        if (Array.isArray(value)) {
          return value.map((item) => humanizeFieldMessage(field, String(item)));
        }

        return typeof value === "string"
          ? [humanizeFieldMessage(field, value)]
          : [];
      })
      .filter(Boolean);

    if (fieldMessages.length > 0) {
      return fieldMessages.join(" | ");
    }
  }

  return fallbackMessage;
}
