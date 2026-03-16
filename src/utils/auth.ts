import type { PayloadRequest } from 'payload'

export function validateApiKey(req: PayloadRequest, apiKey: string): boolean {
  const headerKey = req.headers.get('x-api-key')
  const queryKey = req.searchParams.get('apiKey')
  const providedKey = headerKey ?? queryKey

  return providedKey === apiKey
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: 'Invalid API key' }, { status: 401 })
}
