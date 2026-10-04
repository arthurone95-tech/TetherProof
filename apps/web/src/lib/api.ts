/**
 * Browser-side API access.
 *
 * The API base URL is public configuration and is exposed to the browser on
 * purpose. It is never a secret; access is protected by the API's own
 * authentication and RBAC, not by hiding this value.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as { error?: { message?: string; code?: string } } | null;
    throw new ApiRequestError(
      body?.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
    );
  }

  return payload as T;
}
