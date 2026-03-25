import type { AstroCookies } from 'astro';
import { supabase } from './supabase';
import type { Cart, CartItemView, CartView, Category, Product, ProductImage, ProductVariant } from './types';

const CART_COOKIE = 'elegilsa_cart_token';
const SHOPIFY_PRODUCTS_URL = 'https://elegilsa.com/products.json?limit=250';
let shopifyImageMapPromise: Promise<Map<string, ProductImage[]>> | null = null;

function isSupabaseConnectivityError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '').toLowerCase()
        : '';

  if (!message) return false;

  return (
    message.includes('fetch failed') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('timeout')
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function persistCartToken(cookies: AstroCookies, token: string) {
  cookies.set(CART_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: 60 * 60 * 24 * 30,
  });
}

function sortImages(images: ProductImage[] | null | undefined): ProductImage[] {
  return [...(images ?? [])].sort((a, b) => a.position - b.position);
}

function sortVariants(variants: ProductVariant[] | null | undefined): ProductVariant[] {
  return [...(variants ?? [])].sort((a, b) => a.position - b.position);
}

function normalizeProduct(row: any): Product {
  return {
    ...row,
    product_images: sortImages(row.product_images),
    product_variants: sortVariants(row.product_variants),
  };
}

async function getShopifyImageMap(): Promise<Map<string, ProductImage[]>> {
  if (!shopifyImageMapPromise) {
    shopifyImageMapPromise = (async () => {
      const response = await fetch(SHOPIFY_PRODUCTS_URL, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Shopify catalog: ${response.status}`);
      }

      const payload = (await response.json()) as {
        products?: Array<{
          handle?: string;
          images?: Array<{ src?: string; alt?: string | null }>;
        }>;
      };

      const map = new Map<string, ProductImage[]>();

      for (const product of payload.products ?? []) {
        const handle = typeof product.handle === 'string' ? product.handle.trim() : '';
        if (!handle) continue;

        const images = (product.images ?? [])
          .map((image, index) => {
            const url = typeof image.src === 'string' ? image.src.trim() : '';
            if (!url) return null;

            return {
              id: 10_000_000 + index,
              url,
              alt_text: typeof image.alt === 'string' ? image.alt : null,
              position: index + 1,
            } as ProductImage;
          })
          .filter((image): image is ProductImage => image !== null);

        if (images.length > 0) {
          map.set(handle, images);
        }
      }

      return map;
    })().catch((error) => {
      shopifyImageMapPromise = null;
      throw error;
    });
  }

  return shopifyImageMapPromise;
}

async function withShopifyImageFallback(products: Product[]): Promise<Product[]> {
  try {
    const imageMap = await getShopifyImageMap();
    return products.map((product) => {
      const fallbackImages = imageMap.get(product.slug) ?? [];
      if (fallbackImages.length === 0) return product;

      return {
        ...product,
        product_images: fallbackImages,
      };
    });
  } catch {
    return products;
  }
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)'
      )
      .eq('is_active', true)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const products = (data ?? []).map(normalizeProduct);
    return withShopifyImageFallback(products);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export type ProductListParams = {
  page?: number;
  pageSize?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  inStockOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  categorySlug?: string;
};

export async function getNavigationCategories(): Promise<Category[]> {
  try {
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('id,slug,name,description,created_at')
      .order('name', { ascending: true });

    if (categoriesError) throw categoriesError;

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('category_id')
      .eq('is_active', true);

    if (productsError) throw productsError;

    const counts = new Map<number, number>();
    for (const row of products ?? []) {
      const categoryId = Number((row as any).category_id);
      if (!Number.isFinite(categoryId)) continue;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    return (categories ?? [])
      .map((category: any) => ({
        ...category,
        product_count: counts.get(Number(category.id)) ?? 0,
      }))
      .filter((category) => (category.product_count ?? 0) > 0);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export async function getAllProducts(params: ProductListParams = {}) {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 16, 1), 50);

  let products: Product[] = [];
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)',
        { count: 'exact' }
      )
      .eq('is_active', true);

    if (error) throw error;
    products = (data ?? []).map(normalizeProduct);
  } catch (error) {
    if (!isSupabaseConnectivityError(error)) {
      throw error;
    }
  }

  products = await withShopifyImageFallback(products);

  if (params.inStockOnly) {
    products = products.filter((p) => {
      if (p.product_variants.length === 0) return true;
      return p.product_variants.some((v) => v.is_active && v.stock > 0);
    });
  }

  if (typeof params.minPrice === 'number') {
    products = products.filter((p) => p.price_cents >= params.minPrice!);
  }

  if (typeof params.maxPrice === 'number') {
    products = products.filter((p) => p.price_cents <= params.maxPrice!);
  }

  if (params.q && params.q.trim().length > 0) {
    const q = params.q.trim().toLowerCase();
    products = products.filter((p) => {
      const haystack = `${p.name} ${p.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  if (params.categorySlug && params.categorySlug.trim().length > 0) {
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', params.categorySlug.trim())
      .maybeSingle();

    if (categoryError) throw categoryError;

    if (!category) {
      products = [];
    } else {
      const categoryId = Number((category as any).id);
      products = products.filter((product) => Number(product.category_id) === categoryId);
    }
  }

  switch (params.sort) {
    case 'price_asc':
      products.sort((a, b) => a.price_cents - b.price_cents);
      break;
    case 'price_desc':
      products.sort((a, b) => b.price_cents - a.price_cents);
      break;
    case 'newest':
    default:
      products.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      break;
  }

  const total = products.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = (page - 1) * pageSize;
  const paged = products.slice(start, start + pageSize);

  return {
    products: paged,
    total,
    totalPages,
    page,
    pageSize,
  };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select(
      'id,category_id,slug,name,description,price_cents,compare_at_cents,featured,is_active,created_at,product_images(id,url,alt_text,position),product_variants(*)'
    )
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const [product] = await withShopifyImageFallback([normalizeProduct(data)]);
  return product;
}

export async function getAllProductSlugs(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('slug')
      .eq('is_active', true);

    if (error) throw error;

    return (data ?? [])
      .map((row: any) => (typeof row.slug === 'string' ? row.slug.trim() : ''))
      .filter((slug) => slug.length > 0);
  } catch (error) {
    if (isSupabaseConnectivityError(error)) return [];
    throw error;
  }
}

export async function getOrCreateCart(cookies: AstroCookies): Promise<Cart> {
  const existingToken = cookies.get(CART_COOKIE)?.value ?? null;
  const safeToken = existingToken && isUuid(existingToken) ? existingToken : null;

  const { data, error } = await supabase.rpc('get_or_create_cart', {
    p_cart_token: safeToken,
  });

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to initialize cart.');
  }

  const row = data[0];
  persistCartToken(cookies, row.token);

  return row as Cart;
}

export async function getCartView(cookies: AstroCookies): Promise<CartView> {
  const cart = await getOrCreateCart(cookies);

  const { data: itemRows, error: itemsError } = await supabase.rpc('get_cart_items', {
    p_cart_token: cart.token,
  });

  if (itemsError) throw itemsError;

  const items = itemRows ?? [];

  if (items.length === 0) {
    return {
      cart,
      items: [],
      subtotal_cents: 0,
      total_items: 0,
    };
  }

  const viewItems: CartItemView[] = items
    .map((item: any) => {
      return {
        id: item.item_id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        product: {
          id: item.product_id,
          slug: item.product_slug,
          name: item.product_name,
          price_cents: item.product_price_cents,
          image_url: item.image_url,
        },
        variant: item.variant_id
          ? {
              id: item.variant_id,
              name: item.variant_name,
              color_name: item.color_name,
              color_hex: item.color_hex,
              size_label: item.size_label,
              stock: typeof item.variant_stock === 'number' ? item.variant_stock : null,
            }
          : null,
        line_total_cents: item.quantity * item.unit_price_cents,
      };
    });

  const subtotal_cents = viewItems.reduce((acc, item) => acc + item.line_total_cents, 0);
  const total_items = viewItems.reduce((acc, item) => acc + item.quantity, 0);

  return {
    cart,
    items: viewItems,
    subtotal_cents,
    total_items,
  };
}

export function getCartTokenFromCookies(cookies: AstroCookies): string | null {
  const token = cookies.get(CART_COOKIE)?.value ?? null;
  return token && isUuid(token) ? token : null;
}
