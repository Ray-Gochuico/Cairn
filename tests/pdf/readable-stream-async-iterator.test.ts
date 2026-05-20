import { describe, it, expect } from 'vitest';
import {
  streamAsyncIterator,
  installReadableStreamAsyncIterator,
} from '@/pdf/readable-stream-async-iterator';

function streamOf<T>(values: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const v of values) controller.enqueue(v);
      controller.close();
    },
  });
}

describe('streamAsyncIterator', () => {
  it('yields every chunk in order then completes', async () => {
    const out: number[] = [];
    for await (const v of streamAsyncIterator(streamOf([1, 2, 3]))) out.push(v);
    expect(out).toEqual([1, 2, 3]);
  });

  it('drives the iterator protocol directly', async () => {
    const it = streamAsyncIterator(streamOf(['a']));
    expect(await it.next()).toEqual({ done: false, value: 'a' });
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  it('return() cancels the underlying stream and reports done', async () => {
    let cancelled = false;
    const stream = new ReadableStream<number>({
      start(c) {
        c.enqueue(1);
      },
      cancel() {
        cancelled = true;
      },
    });
    const it = streamAsyncIterator(stream);
    expect(await it.next()).toEqual({ done: false, value: 1 });
    const ret = await it.return!(undefined);
    expect(ret.done).toBe(true);
    expect(cancelled).toBe(true);
  });
});

describe('installReadableStreamAsyncIterator', () => {
  it('leaves ReadableStream async-iterable and is idempotent', () => {
    installReadableStreamAsyncIterator();
    installReadableStreamAsyncIterator();
    expect(typeof ReadableStream.prototype[Symbol.asyncIterator]).toBe('function');
  });
});
