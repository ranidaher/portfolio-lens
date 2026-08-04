export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tickers, months } = req.body;

  // months is an array of { year, month } objects
  // We fetch historical prices for each ticker at each month-end

  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'No tickers provided' });
  }

  // Determine date range: from earliest month to now
  const sortedMonths = [...months].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  if (sortedMonths.length === 0) {
    return res.status(200).json({ history: {} });
  }

  const startDate = new Date(sortedMonths[0].year, sortedMonths[0].month - 1, 1);
  const endDate = new Date();

  // Add buffer days
  const period1 = Math.floor(startDate.getTime() / 1000) - 86400;
  const period2 = Math.floor(endDate.getTime() / 1000) + 86400;

  const history = {};

  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1mo`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        history[ticker] = {};
        continue;
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];

      if (result && result.timestamp && result.indicators?.quote?.[0]?.close) {
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const currency = result.meta?.currency || 'USD';

        const pricesByMonth = {};

        for (let i = 0; i < timestamps.length; i++) {
          const date = new Date(timestamps[i] * 1000);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const price = closes[i];
          if (price !== null && price !== undefined) {
            pricesByMonth[key] = price;
          }
        }

        history[ticker] = { prices: pricesByMonth, currency };
      } else {
        history[ticker] = {};
      }
    } catch (err) {
      history[ticker] = {};
    }
  }

  return res.status(200).json({ history });
}
