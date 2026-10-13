export async function resolve(spec, ctx, next) {
  if (spec === 'sdk') return { url: new URL('./sdk.mjs', import.meta.url).href, shortCircuit: true };
  if (spec === 'sdk/db') return { url: new URL('./sdkdb.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
