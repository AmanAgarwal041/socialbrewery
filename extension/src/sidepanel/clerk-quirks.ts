// Imported first by the side panel, before Clerk loads.
//
// Clerk Protect (bot protection, turned on in the Clerk instance) tells clerk-js to inject a remote
// script from cdn.protect.clerk.com. MV3 extension pages may not run remote code, so Chrome blocks it
// and lists a CSP error on chrome://extensions. The script can never run here, so the extension drops
// the loaders from Clerk's environment response instead of attempting it. The extension never signs in
// by itself (it shares the dashboard's session through syncHost), and the dashboard keeps Protect.

const nativeFetch = globalThis.fetch.bind(globalThis)

function isEnvironmentRequest(input: RequestInfo | URL) {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return url.pathname.endsWith('/v1/environment')
  } catch {
    return false
  }
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await nativeFetch(input, init)
  if (!isEnvironmentRequest(input) || !response.ok) return response
  try {
    const body = await response.clone().json()
    if (!body?.protect_config?.loaders?.length) return response
    body.protect_config = { ...body.protect_config, loaders: [] }
    return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch {
    return response
  }
}

// Clerk logs this on every load with a development instance (pk_test_ keys). It is expected until the
// app moves to production Clerk keys, so it is kept out of the extension's error list.
const nativeWarn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Clerk has been loaded with development keys')) return
  nativeWarn(...args)
}

export {}
