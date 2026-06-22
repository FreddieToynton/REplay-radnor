// Stripe calls this function automatically the moment a payment actually
// succeeds. This is what makes a card-bought clock disappear for real -
// not the click on "Submit order", which only happens BEFORE payment.

const Stripe = require('stripe');
const { Redis } = require('@upstash/redis');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const redis = Redis.fromEnv();

// Stripe needs the raw, unparsed request body to verify the signature,
// so we tell Vercel not to auto-parse this one route as JSON.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature check failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const idsString = session.metadata && session.metadata.productIds;

    if (idsString) {
      const ids = idsString.split(',').map((id) => parseInt(id, 10));
      const current = (await redis.get('sold-ids')) || [];
      const updated = Array.from(new Set([...current, ...ids]));
      await redis.set('sold-ids', updated);
    }
  }

  res.status(200).json({ received: true });
};
