import type { APIRoute } from 'astro';
import Stripe from 'stripe';

export const prerender = false;

type RefundRequestPayload = {
  order_id?: unknown;
  amount_cents?: unknown;
  payment_intent_id?: unknown;
  stripe_session_id?: unknown;
};

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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function readPaymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  if (typeof session.payment_intent === 'string' && session.payment_intent.trim()) {
    return session.payment_intent.trim();
  }

  if (
    session.payment_intent &&
    typeof session.payment_intent === 'object' &&
    'id' in session.payment_intent &&
    typeof session.payment_intent.id === 'string' &&
    session.payment_intent.id.trim()
  ) {
    return session.payment_intent.id.trim();
  }

  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = (await request.json()) as RefundRequestPayload;

    const orderId = normalizeText(payload?.order_id).slice(0, 80);
    const amountCents = normalizePositiveInt(payload?.amount_cents);
    let paymentIntentId = normalizeText(payload?.payment_intent_id);
    const stripeSessionId = normalizeText(payload?.stripe_session_id);

    if (amountCents <= 0) {
      return jsonResponse({ error: 'El importe del reembolso debe ser mayor que cero.' }, 400);
    }

    const stripe = new Stripe(readStripeSecretKey());

    if (!paymentIntentId && stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
        expand: ['payment_intent'],
      });
      paymentIntentId = readPaymentIntentIdFromSession(session) || '';
    }

    if (!paymentIntentId) {
      return jsonResponse({ error: 'Falta payment_intent_id (o stripe_session_id válido) para reembolsar.' }, 400);
    }

    const idempotencyKey = `refund-${orderId || paymentIntentId}-${amountCents}`.slice(0, 255);

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: 'requested_by_customer',
        metadata: {
          order_id: orderId,
        },
      },
      {
        idempotencyKey,
      }
    );

    return jsonResponse({
      refundId: refund.id,
      status: refund.status,
      amountCents: refund.amount,
      currency: refund.currency,
      paymentIntentId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el reembolso en Stripe.';
    return jsonResponse({ error: message }, 500);
  }
};
