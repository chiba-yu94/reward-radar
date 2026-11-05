"""Report an owner-maintained, local-only ledger. Unknown observations stay unknown."""
import argparse
import json
from pathlib import Path
from decimal import Decimal, InvalidOperation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ledger", type=Path, help="local monthly ledger JSON")
    args = parser.parse_args()
    row = json.loads(args.ledger.read_text(), parse_float=Decimal)
    print(row["month"])
    for key in ("page_visits", "outbound_clicks", "affiliate_clicks", "verified_conversions",
                "commission_received_jpy", "platform_fees_jpy", "direct_cost_jpy"):
        value = row[key]
        print(f"{key}: {'unmeasured' if value is None else value}")
    amounts = [row[key] for key in ("commission_received_jpy", "platform_fees_jpy", "direct_cost_jpy")]
    if any(amount is None for amount in amounts):
        print("net_revenue_jpy: unmeasured")
        return
    try:
        commission, fees, costs = (Decimal(str(amount)) for amount in amounts)
    except InvalidOperation as error:
        raise SystemExit("Invalid amount") from error
    if not all(amount.is_finite() and amount >= 0 for amount in (commission, fees, costs)):
        raise SystemExit("Amounts must be finite and nonnegative")
    net = commission - fees - costs
    print(f"net_revenue_jpy: {net}")
    print(f"remaining_to_minimum_jpy: {max(Decimal(5000) - net, 0)}")


if __name__ == "__main__":
    main()
