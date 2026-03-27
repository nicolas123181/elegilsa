import type { APIRoute } from 'astro';
import Stripe from 'stripe';

export const prerender = false;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function readStripeSecretKey(): string {
  const key = import.meta.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Falta STRIPE_SECRET_KEY en variables de entorno.');
  }
  return key;
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const sessionId = url.searchParams.get('session_id')?.trim();
    if (!sessionId) {
      return jsonResponse({ error: 'Falta session_id para verificar.' }, 400);
    }

    const stripe = new Stripe(readStripeSecretKey());
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paid = session.payment_status === 'paid' || session.status === 'complete';

    return jsonResponse({
      paid,
      status: session.status,
      paymentStatus: session.payment_status,
      currency: session.currency,
      amountTotal: session.amount_total,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      orderId: session.metadata?.order_id || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo verificar la sesion de Stripe.';
    return jsonResponse({ error: message }, 500);
  }
};
