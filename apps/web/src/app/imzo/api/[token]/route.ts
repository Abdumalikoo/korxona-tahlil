// ═══════════════════════════════════════════════════════════
// Telefon uchun vositachi: telefon faqat shu sahifa manziliga (kompyuter IP:3000)
// murojaat qiladi, Next esa so'rovni API ga (shu kompyuterdagi localhost:3001) uzatadi.
// Shunda telefonda CORS ham, «localhost» muammosi ham bo'lmaydi.
// ═══════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');

function target(token: string): string | null {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? `${API}/public/acts/${token}` : null;
}

function forward(req: Request): Record<string, string> {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
  const h: Record<string, string> = { accept: 'application/json', 'user-agent': req.headers.get('user-agent') ?? '' };
  if (ip) h['x-forwarded-for'] = ip;
  return h;
}

async function relay(res: Response): Promise<Response> {
  const body = await res.text();
  return new Response(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}

function fail(status: number, message: string): Response {
  return Response.json({ success: false, statusCode: status, message }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const url = target((await ctx.params).token);
  if (!url) return fail(404, 'Havola noto‘g‘ri');
  try {
    return await relay(await fetch(url, { headers: forward(req), cache: 'no-store' }));
  } catch {
    return fail(502, 'Server bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring');
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const url = target((await ctx.params).token);
  if (!url) return fail(404, 'Havola noto‘g‘ri');
  const body = await req.text();
  if (body.length > 600_000) return fail(413, 'Imzo rasmi juda katta');
  try {
    return await relay(await fetch(`${url}/sign`, { method: 'POST', headers: { ...forward(req), 'content-type': 'application/json' }, body, cache: 'no-store' }));
  } catch {
    return fail(502, 'Server bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring');
  }
}