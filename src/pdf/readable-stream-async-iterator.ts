/**
 * Polyfill for `ReadableStream` async iteration.
 *
 * WebKit — including the current macOS WKWebView that Tauri runs the app in —
 * does not implement async iteration of `ReadableStream` (`Symbol.asyncIterator`
 * / `values()`). `pdfjs-dist`'s `getTextContent()` does
 * `for await (const value of stream)` over a `ReadableStream`, which throws
 * `undefined is not a function` in that environment.
 *
 * This module adds the standard behavior, built only on `getReader()` /
 * `read()` / `cancel()` (universally supported). It is a guarded no-op on
 * engines that already implement async iteration (Chrome, Firefox, Node).
 */

interface AsyncIteratorOptions {
  preventCancel?: boolean;
}

/**
 * Build a spec-faithful async iterator over a `ReadableStream` using only the
 * widely-supported reader API. Exported separately so it can be unit-tested
 * directly, independent of whether the host engine already supports async
 * iteration of streams.
 */
export function streamAsyncIterator<R>(
  stream: ReadableStream<R>,
  { preventCancel = false }: AsyncIteratorOptions = {},
): AsyncIterableIterator<R> {
  const reader = stream.getReader();
  return {
    async next(): Promise<IteratorResult<R>> {
      try {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          return { done: true, value: undefined };
        }
        return { done: false, value };
      } catch (err) {
        reader.releaseLock();
        throw err;
      }
    },
    async return(value?: unknown): Promise<IteratorResult<R>> {
      if (!preventCancel) {
        const cancelPromise = reader.cancel(value);
        reader.releaseLock();
        await cancelPromise;
      } else {
        reader.releaseLock();
      }
      return { done: true, value: value as R };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * Install `ReadableStream.prototype[Symbol.asyncIterator]` / `values()` when
 * the host engine lacks them. Idempotent and safe to call repeatedly. Call
 * once before any code (e.g. pdfjs) async-iterates a stream.
 */
export function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return;
  const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
  if (typeof proto[Symbol.asyncIterator] === 'function') return;

  function values(this: ReadableStream, options?: AsyncIteratorOptions) {
    return streamAsyncIterator(this, options);
  }
  Object.defineProperty(proto, 'values', {
    value: values,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(proto, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
