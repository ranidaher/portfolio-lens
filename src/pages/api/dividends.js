export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tickers } = req.body;
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'No tickers provided' });
  }

  const dividends = {};

  for (const ticker of tickers) {
    try {
      // Fetch 3 years of dividend history
      const now = Math.floor(Date.now() / 1000);
      const threeYearsAgo = now - (3 * 365 * 24 * 60 * 60);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${threeYearsAgo}&period2=${now}&interval=1mo&events=div`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

      if (!response.ok) { dividends[ticker] = []; continue; }

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const divEvents = result?.events?.dividends;

      if (divEvents) {
        const divList = Object.values(divEvents).map(d => ({
          date: new Date(d.date * 1000).toISOString().slice(0, 10),
          amount: d.amount,
        })).sort((a, b) => b.date.localeCompare(a.date));
        dividends[ticker] = divList;
      } else {
        dividends[ticker] = [];
      }
    } catch (err) {
      dividends[ticker] = [];
    }
  }

  return res.status(200).json({ dividends });
}
