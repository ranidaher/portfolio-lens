export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tickers } = req.body;
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'No tickers provided' });
  }

  const volatility = {};

  for (const ticker of tickers) {
    try {
      // Fetch 1 year of daily prices
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - (365 * 24 * 60 * 60);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneYearAgo}&period2=${now}&interval=1d`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

      if (!response.ok) { volatility[ticker] = null; continue; }

      const data = await response.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;

      if (!closes || closes.length < 20) { volatility[ticker] = null; continue; }

      // Calculate daily returns
      const returns = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i] !== null && closes[i - 1] !== null && closes[i - 1] > 0) {
          returns.push(Math.log(closes[i] / closes[i - 1]));
        }
      }

      if (returns.length < 10) { volatility[ticker] = null; continue; }

      // Standard deviation of daily returns
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const dailyVol = Math.sqrt(variance);

      // Annualize: daily vol * sqrt(252 trading days)
      const annualVol = dailyVol * Math.sqrt(252);

      volatility[ticker] = {
        annual: Math.round(annualVol * 10000) / 100, // as percentage, e.g., 15.23
        daily: Math.round(dailyVol * 10000) / 100,
        dataPoints: returns.length,
      };
    } catch (err) {
      volatility[ticker] = null;
    }
  }

  return res.status(200).json({ volatility });
}
