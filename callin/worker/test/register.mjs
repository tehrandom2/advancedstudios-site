// node --import ./test/register.mjs: lets Node load worker.js, mapping 'cloudflare:workers' to a small stub.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
