import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Use service role key if available, otherwise anon key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Get ALL trades for this user (with security info for currency)
  const { data: trades, error } = await supabase
    .from('trades')
    .select('*, securities(ticker, currency)')
    .eq('user_id', user_id);

  if (error) return res.status(500).json({ error: error.message });
  if (!trades || trades.length === 0) return res.status(200).json({ message: 'No trades found', updated: 0 });

  // Filter to only trades without FX rate
  const needsBackfill = trades.filter(t => !t.fx_rate_to_usd);
  if (needsBackfill.length === 0) return res.status(200).json({ message: 'All trades already have FX rates', updated: 0 });

  // Get unique currencies
  const currencies = [...new Set(needsBackfill.map(t => t.securities?.currency).filter(c => c && c !== 'USD'))];

  // Fetch current FX rates
  let fxRates = { USD: 1 };
  if (currencies.length > 0) {
    try {
      const pairs = currencies.map(c => `${c}USD=X`);
      for (const currency of currencies) {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(currency)}USD=X?range=1d&interval=1d`;
        const fxRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (fxRes.ok) {
          const fxData = await fxRes.json();
          const rate = fxData?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (rate) fxRates[currency] = rate;
        }
      }
    } catch {}
  }

  // Update each trade
  let updated = 0;
  for (const trade of needsBackfill) {
    const currency = trade.securities?.currency || 'USD';
    const fxRate = currency === 'USD' ? 1 : (fxRates[currency] || 1);

    await supabase
      .from('trades')
      .update({ fx_rate_to_usd: fxRate })
      .eq('id', trade.id);
    updated++;
  }

  return res.status(200).json({ message: `Backfilled ${updated} trades with current FX rates`, updated, rates: fxRates });
}
