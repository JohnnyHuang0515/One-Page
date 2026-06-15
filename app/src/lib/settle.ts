/**
 * D-0005: greedy debt minimization.
 * net = paid_total - owed_total per member (BR-9: sum of nets === 0).
 * Repeatedly match largest debtor with largest creditor.
 * Produces at most (members - 1) transactions.
 */
export type Transfer = { fromMemberId: string; toMemberId: string; amount: number };

export function minimizeDebts(nets: Map<string, number>): Transfer[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];
  for (const [id, net] of nets) {
    if (net > 0) creditors.push({ id, amt: net });
    else if (net < 0) debtors.push({ id, amt: -net });
  }
  // Deterministic order: largest first, tie-break by id
  const byAmtDesc = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || a.id.localeCompare(b.id);
  creditors.sort(byAmtDesc);
  debtors.sort(byAmtDesc);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const x = Math.min(c.amt, d.amt);
    transfers.push({ fromMemberId: d.id, toMemberId: c.id, amount: x });
    c.amt -= x;
    d.amt -= x;
    if (c.amt === 0) ci++;
    if (d.amt === 0) di++;
  }
  return transfers;
}

/** Compute per-member nets from expenses+shares. */
export function computeNets(
  expenses: { payerId: string; amount: number }[],
  shares: { memberId: string; shareAmount: number }[],
  allMemberIds: string[]
): Map<string, number> {
  const nets = new Map<string, number>(allMemberIds.map((id) => [id, 0]));
  for (const e of expenses) nets.set(e.payerId, (nets.get(e.payerId) ?? 0) + e.amount);
  for (const s of shares) nets.set(s.memberId, (nets.get(s.memberId) ?? 0) - s.shareAmount);
  return nets;
}
