export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tickers } = req.body;

  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'No tickers provided' });
  }

  const prices = {};

  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        prices[ticker] = { error: 'Failed to fetch', price: null };
        continue;
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];

      if (result) {
        const meta = result.meta;
        const price = meta.regularMarketPrice || null;
        const previousClose = meta.chartPreviousClose || meta.previousClose || null;
        const currency = meta.currency || 'USD';
        const name = meta.shortName || meta.longName || ticker;

        prices[ticker] = { price, previousClose, currency, name };
      } else {
        prices[ticker] = { error: 'No data', price: null };
      }
    } catch (err) {
      prices[ticker] = { error: err.message, price: null };
    }
  }

  return res.status(200).json({ prices });
}
