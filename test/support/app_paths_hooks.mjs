const root = new URL('../../', import.meta.url)

export async function resolve(specifier, context, next) {
  if (/^\/(app|lib|config)\//.test(specifier)) return next(new URL(specifier.slice(1), root).href, context)
  return next(specifier, context)
}

