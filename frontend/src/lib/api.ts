import { getToken } from "./token";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const ENABLE_TRANSACTIONS_API = false;
// flip to true once backend /transactions is ready

export type Transaction = {
  amount: number;
  to: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  createdAt: string;
  txHash?: string;
};

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${rawBody}`);
  }

  if (contentType.includes("application/json")) {
    return (rawBody ? JSON.parse(rawBody) : {}) as T;
  }

  return rawBody as T;
}

export async function transferTokens(
  to: string,
  amount: number
): Promise<{ txHash?: string }> {
  void to;
  void amount;
  throw new Error("Not implemented yet");
}

export async function fetchTransactions(): Promise<Transaction[]> {
  if (!ENABLE_TRANSACTIONS_API) {
    throw new Error("Not implemented yet");
  }

  const response = await fetch(`${BASE_URL}/transactions`);

  if (!response.ok) {
    throw new Error("Failed to fetch transactions");
  }

  return (await response.json()) as Transaction[];
}
