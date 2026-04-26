import { getToken } from "./token";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const TRANSFERS_BLOCKED_MESSAGE =
  "Real transfers are still disabled in the frontend. The current backend signer and token provisioning flow is not safe to expose for app-created wallets yet.";

export type AuthUser = {
  userId: number | string;
  email: string;
};

export type WalletBalance = {
  walletAddress: string;
  balance: string;
  source?: string;
};

export type CreateWalletResponse = {
  userId: number | string;
  walletAddress: string;
  publicKey: string;
};

export type TransactionStatus = "PENDING" | "CONFIRMED" | "FAILED";

export type TransactionType = "SYSTEM_FUNDING" | "USER_TRANSFER";

export type TransactionListItem = {
  txId: number | string;
  type: TransactionType;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  status: TransactionStatus;
  txHash: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

type ApiErrorOptions = {
  status: number;
  message: string;
  rawBody?: string;
  details?: unknown;
  code?: string;
};

export class ApiError extends Error {
  status: number;
  rawBody: string;
  details?: unknown;
  code?: string;

  constructor({ status, message, rawBody = "", details, code }: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rawBody = rawBody;
    this.details = details;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong."
): string {
  if (isApiError(error)) {
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function parseResponseBody(
  rawBody: string,
  contentType: string
): { parsedBody?: unknown; rawBody: string } {
  if (!rawBody || !contentType.includes("application/json")) {
    return { rawBody };
  }

  try {
    return {
      rawBody,
      parsedBody: JSON.parse(rawBody),
    };
  } catch {
    return { rawBody };
  }
}

function getStringField(
  parsedBody: unknown,
  field: "message" | "error" | "code"
): string | null {
  if (!parsedBody || typeof parsedBody !== "object") {
    return null;
  }

  const value = Reflect.get(parsedBody, field);
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return null;
}

async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  const { parsedBody } = parseResponseBody(rawBody, contentType);

  if (!response.ok) {
    const message =
      getStringField(parsedBody, "message") ||
      getStringField(parsedBody, "error") ||
      rawBody.trim() ||
      `Request failed with status ${response.status}.`;

    throw new ApiError({
      status: response.status,
      message,
      rawBody,
      details: parsedBody,
      code: getStringField(parsedBody, "code") || undefined,
    });
  }

  if (contentType.includes("application/json")) {
    if (parsedBody !== undefined) {
      return parsedBody as T;
    }

    return {} as T;
  }

  return rawBody as T;
}

function buildHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);

  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = buildHeaders(options);

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Unable to reach the API server.",
      details: error,
    });
  }

  return readResponse<T>(response);
}

export async function transferTokens(
  toAddress: string,
  amount: string
): Promise<TransactionListItem> {
  void toAddress;
  void amount;

  throw new ApiError({
    status: 503,
    code: "FEATURE_UNAVAILABLE",
    message: TRANSFERS_BLOCKED_MESSAGE,
  });
}

export async function fetchTransactions(
  type?: TransactionType
): Promise<TransactionListItem[]> {
  const params = new URLSearchParams();

  if (type) {
    params.set("type", type);
  }

  const query = params.toString();
  const path = query ? `/transactions?${query}` : "/transactions";

  return apiFetch<TransactionListItem[]>(path);
}
