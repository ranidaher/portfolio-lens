export const ASSET_CLASSES = ['equity', 'bond', 'cash_mmf', 'commodity'];
export const REGIONS = ['US', 'Canada', 'UK', 'Europe', 'Global', 'Other'];
export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'CHF', 'JPY', 'AUD', 'Other'];
export const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'France', 'Germany', 'Greece', 'Switzerland', 'Japan', 'Australia', 'Other'];
export const ACCOUNT_TYPES = ['brokerage', 'real_estate', 'savings'];

export const ASSET_CLASS_LABELS = { equity: 'Equities', bond: 'Bonds', cash_mmf: 'Cash / MMF', commodity: 'Commodities' };
export const ACCOUNT_TYPE_LABELS = { brokerage: 'Brokerage', real_estate: 'Real Estate', savings: 'Savings' };

export const fmt = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRound = (n) => Math.round(Number(n)).toLocaleString();
