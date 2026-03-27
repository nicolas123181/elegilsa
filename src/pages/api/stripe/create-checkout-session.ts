import type { APIRoute } from 'astro';
import Stripe from 'stripe';

export const prerender = false;

type InputItem = {
  name?: unknown;
  variantName?: unknown;
  quantity?: unknown;
  unitPriceCents?: unknown;
};

type NormalizedCheckoutItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function normalizeText(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function normalizePositiveInt(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function readStripeSecretKey(): string {
  const key = import.meta.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Falta STRIPE_SECRET_KEY en variables de entorno.');
  }
  return key;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();

    const items: NormalizedCheckoutItem[] = (Array.isArray(payload?.items) ? payload.items : [])
      .map((item: InputItem) => {
        const quantity = normalizePositiveInt(item?.quantity);
        const unitPriceCents = normalizePositiveInt(item?.unitPriceCents);
        const baseName = normalizeText(item?.name, 'Producto Elegilsa');
        const variantName = normalizeText(item?.variantName, '');

        return {
          quantity,
          unitPriceCents,
          name: variantName ? `${baseName} (${variantName})` : baseName,
        };
      })
      .filter((item: NormalizedCheckoutItem) => item.quantity > 0 && item.unitPriceCents > 0);

    if (items.length === 0) {
      return jsonResponse({ error: 'No hay productos validos para pagar.' }, 400);
    }

    const shippingCents = normalizePositiveInt(payload?.shipping_cents);
    const shippingMethod = payload?.shipping_method === 'express' ? 'express' : 'standard';
    const orderId = normalizeText(payload?.order_id, `ELEG-${Date.now()}`).slice(0, 80);
    const customerId = normalizeText(payload?.customer_id, '').slice(0, 80);

    const shippingData = payload?.shipping_data && typeof payload.shipping_data === 'object' ? payload.shipping_data : {};
    const customerName = normalizeText((shippingData as Record<string, unknown>)?.full_name, 'Cliente Elegilsa');
    const customerPhone = normalizeText((shippingData as Record<string, unknown>)?.phone, '');

    const stripe = new Stripe(readStripeSecretKey());
    const origin = new URL(request.url).origin;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item: NormalizedCheckoutItem) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'eur',
        unit_amount: item.unitPriceCents,
        product_data: {
          name: item.name,
        },
      },
    }));

    if (shippingCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: shippingCents,
          product_data: {
            name: shippingMethod === 'express' ? 'Envio express' : 'Envio estandar',
          },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${origin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout?stripe=cancel`,
      billing_address_collection: 'required',
      customer_creation: 'always',
      phone_number_collection: {
        enabled: true,
      },
      locale: 'es',
      metadata: {
        order_id: orderId,
        customer_id: customerId,
        shipping_method: shippingMethod,
        customer_name: customerName.slice(0, 120),
        customer_phone: customerPhone.slice(0, 40),
      },
    });

    if (!session.url) {
      return jsonResponse({ error: 'Stripe no devolvio URL de checkout.' }, 500);
    }

    return jsonResponse({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear la sesion de Stripe.';
    return jsonResponse({ error: message }, 500);
  }
};
