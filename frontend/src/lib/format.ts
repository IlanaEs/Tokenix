export function shortHash(value?: string | null): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();

  if (trimmed.length <= 10) {
    return trimmed;
  }

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
