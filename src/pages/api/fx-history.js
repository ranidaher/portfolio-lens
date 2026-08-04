export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { currencies, months } = req.body;

  const needed = (currencies || []).filter(c => c !== 'USD' && c !== 'Other');

  if (needed.length === 0) {
    return res.status(200).json({ history: {} });
  }

  const sortedMonths = [...months].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  if (sortedMonths.length === 0) {
    return res.status(200).json({ history: {} });
  }

  const startDate = new Date(sortedMonths[0].year, sortedMonths[0].month - 1, 1);
  const endDate = new Date();

  const period1 = Math.floor(startDate.getTime() / 1000) - 86400;
  const period2 = Math.floor(endDate.getTime() / 1000) + 86400;

  const history = {};

  for (const currency of needed) {
    try {
      const ticker = `${currency}USD=X`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1mo`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        history[currency] = {};
        continue;
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];

      if (result && result.timestamp && result.indicators?.quote?.[0]?.close) {
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        const ratesByMonth = {};
        for (let i = 0; i < timestamps.length; i++) {
          const date = new Date(timestamps[i] * 1000);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (closes[i] !== null && closes[i] !== undefined) {
            ratesByMonth[key] = closes[i];
          }
        }

        history[currency] = ratesByMonth;
      } else {
        history[currency] = {};
      }
    } catch {
      history[currency] = {};
    }
  }

  return res.status(200).json({ history });
}
