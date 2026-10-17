"""The symbols the backend streams. Must match the frontend universe (src/app/core/data/asset-universe.ts)."""

# Our ticker -> Binance stream symbol. Real, live prices.
CRYPTO: dict[str, str] = {
    "BTC": "btcusdt",
    "ETH": "ethusdt",
    "SOL": "solusdt",
    "BNB": "bnbusdt",
    "ADA": "adausdt",
    "DOT": "dotusdt",
    "AVAX": "avaxusdt",
    "DOGE": "dogeusdt",
    "LINK": "linkusdt",
    "UNI": "uniusdt",
    "MATIC": "polusdt",  # Polygon renamed MATIC -> POL on Binance (Sept 2024)
}

# NSE stocks have no free real-time feed, so the backend simulates them (base price = session open).
SIMULATED_STOCKS: dict[str, float] = {
    "RELIANCE": 2950.00,
    "TCS": 4150.00,
    "INFY": 1880.00,
    "HDFCBANK": 1680.00,
    "ICICIBANK": 1120.00,
    "WIPRO": 560.00,
    "ADANIPORTS": 1350.00,
    "BAJFINANCE": 7200.00,
    "MARUTI": 12400.00,
    "TITAN": 3600.00,
    "SUNPHARMA": 1750.00,
    "ONGC": 275.00,
    "POWERGRID": 330.00,
    "LTIM": 5800.00,
}

ALL_SYMBOLS: frozenset[str] = frozenset(CRYPTO) | frozenset(SIMULATED_STOCKS)
