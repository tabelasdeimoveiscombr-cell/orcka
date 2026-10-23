export interface RetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const shouldRetry = options.shouldRetry ?? (() => false);
  const pause = options.wait ?? wait;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      await pause(initialDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new Error("Operação esgotou as tentativas configuradas.");
}
