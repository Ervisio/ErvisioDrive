// Test helper: lets node load src/ modules whose relative imports omit the .ts extension (Vite resolves them in the
// build). Registered from the tests with module.register().
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      /* fall through */
    }
  }
  return next(specifier, context);
}
