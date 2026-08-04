export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { currencies } = req.body;

  if (!currencies || !Array.isArray(currencies) || currencies.length === 0) {
    return res.status(400).json({ error: 'No currencies provided' });
  }

  // Filter out USD since that's our base
  const needed = currencies.filter(c => c !== 'USD' && c !== 'Other');

  if (needed.length === 0) {
    return res.status(200).json({ rates: { USD: 1 } });
  }

  try {
    // Use Yahoo Finance for FX rates (free, no API key needed)
    const rates = { USD: 1 };

    for (const currency of needed) {
      try {
        const ticker = `${currency}USD=X`;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (response.ok) {
          const data = await response.json();
          const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price) {
            rates[currency] = price;
          } else {
            rates[currency] = null;
          }
        } else {
          rates[currency] = null;
        }
      } catch {
        rates[currency] = null;
      }
    }

    return res.status(200).json({ rates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
