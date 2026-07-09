export async function handleWorldSession(_request: Request, _env: unknown): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  })
}
