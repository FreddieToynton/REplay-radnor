// Tells the website which products have already sold.
// Uses Upstash Redis (set up via the Vercel Marketplace) - a free, simple
// key-value store. Vercel injects the connection details automatically
// once you add the integration, so there's nothing to copy/paste here.

const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

module.exports = async function handler(req, res) {
  try {
    const sold = await redis.get('sold-ids');

    res.status(200).json({ soldIds: sold || [] });
  } catch (err) {
    console.error(err);
    // If anything goes wrong, fail safe: report nothing as sold rather
    // than breaking the whole shop page.
    res.status(200).json({ soldIds: [] });
  }
};
