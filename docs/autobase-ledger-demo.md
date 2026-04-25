# Simple Autobase Ledger Demo

This version is a real event ledger demo:

1. Alice creates an Autobase.
2. Alice adds Bob as a writer.
3. The `apply` function turns writer commands into a single append-only ledger log.
4. Balances are computed later by replaying the ledger entries.

Run it with:

```bash
npm run demo:ledger
```

Or pick a persistent storage directory:

```bash
node scripts/autobase-ledger-demo.js ./.demo/autobase-ledger
```

What changed:

- `open(store)` returns a plain append-only view core for the ledger log.
- `apply(nodes, view, host)` only appends normalized ledger entries.
- The ledger only stores `grant` and `transfer` entries.
- Balances are calculated by reading the log, not by storing `balance:alice` style keys.
- Transfers do not need to be rejected just because replayed balance is temporarily negative; later logs can bring the state back in line.

Why this maps well to your project:

- Each peer can be a writer.
- Credits are append-only events, which is a natural fit for Autobase.
- Balances are deterministic state derived from replaying the shared history.
- Later you can replace `mint` with signed funding rules and add escrow or prompt receipts as more command types.

Important constraint:

Autobase can reorder messages while peers catch up, so the view must stay deterministic. If you want a pure ledger, store only canonical entries in the view and derive balances, invoices, or receipts by replaying that history.
