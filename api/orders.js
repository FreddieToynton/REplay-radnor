// This file runs on Vercel's servers, NOT in the browser.
// That's why it's safe to use your Stripe SECRET key here.

const Stripe = require('stripe');
const { Redis } = require('@upstash/redis');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const redis = Redis.fromEnv();

async function markSold(ids) {
  const current = (await redis.get('sold-ids')) || [];
  const updated = Array.from(new Set([...current, ...ids]));
  await redis.set('sold-ids', updated);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const data = req.body;
    const { name, email, message, paymentMethod, basket } = data;

    if (!basket || basket.length === 0) {
      res.status(400).json({ error: 'Basket is empty' });
      return;
    }

    // 1. Always notify you via Formspree, regardless of payment method
    await fetch(process.env.FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name,
        email,
        message,
        paymentMethod,
        items: basket.map((i) => `${i.name} (£${i.price})`).join(', '),
        total: `£${basket.reduce((s, i) => s + i.price, 0)}`,
      }),
    });

    // 2. If paying online, create a Stripe Checkout session and hand the
    //    front-end a URL to redirect the customer to. We do NOT mark items
    //    sold here - they're only reserved once Stripe confirms payment
    //    actually went through (see api/stripe-webhook.js).
    if (paymentMethod === 'card') {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: basket.map((item) => ({
          price_data: {
            currency: 'gbp',
            product_data: { name: item.name },
            unit_amount: Math.round(item.price * 100), // pence
          },
          quantity: 1,
        })),
        metadata: {
          productIds: basket.map((item) => item.id).join(','),
        },
        success_url: `${process.env.URL}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.URL}/?cancelled=true`,
      });

      res.status(200).json({ checkoutUrl: session.url });
      return;
    }

    // 3. Cash on collection - the customer is committed, so mark items
    //    sold straight away.
    await markSold(basket.map((item) => item.id));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong processing the order.' });
  }
};
