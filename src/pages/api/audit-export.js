import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const [secRes, tradeRes, accRes, savRes, propRes, taRes] = await Promise.all([
    supabase.from('securities').select('*').eq('user_id', user_id),
    supabase.from('trades').select('*').eq('user_id', user_id).order('trade_date'),
    supabase.from('accounts').select('*').eq('user_id', user_id),
    supabase.from('savings_ledger').select('*').eq('user_id', user_id).order('year_month'),
    supabase.from('properties').select('*').eq('user_id', user_id),
    supabase.from('target_allocations').select('*').eq('user_id', user_id),
  ]);

  res.status(200).json({
    securities: secRes.data || [],
    trades: tradeRes.data || [],
    accounts: accRes.data || [],
    savings_ledger: savRes.data || [],
    properties: propRes.data || [],
    target_allocations: taRes.data || [],
  });
}
