import type { APIRoute } from 'astro';
import { searchProductsByQuery } from '../../lib/store';

export const prerender = false;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const query = String(url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '8'), 1), 12);

    if (!query) {
      return jsonResponse({ products: [] });
    }

    const products = await searchProductsByQuery(query, limit);
    return jsonResponse({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la busqueda.';
    return jsonResponse({ error: message, products: [] }, 500);
  }
};
