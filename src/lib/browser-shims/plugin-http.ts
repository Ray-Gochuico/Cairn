export const fetch: typeof globalThis.fetch = (input, init) => {
  console.warn('[browser-shim/http] passing through to native fetch (CORS will apply):', input);
  return globalThis.fetch(input, init);
};
