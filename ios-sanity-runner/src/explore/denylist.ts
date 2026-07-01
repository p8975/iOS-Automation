/**
 * Read-only-safe crawl guard. The exploratory crawl drives a REAL logged-in
 * account, so it must never tap a control that spends money, changes account
 * state, signs out, deletes data, or leaves the app. We match by substring on a
 * control's accessibility id and/or visible label (case-insensitive). Defaults
 * can be extended per project via `explore.deny` in runner.config.yaml.
 */
export const DEFAULT_DENY: readonly string[] = [
  // money / subscription
  'subscribe', 'subscription', 'pay', 'payment', 'buy', 'purchase', 'checkout',
  'upgrade', 'renew', 'billing', 'redeem', 'coupon', 'place order', 'proceed to pay',
  // trial state changes (a trial start is a real, pre-charge state change)
  'start trial', 'start_trial', 'starttrial', 'free trial', 'activate plan',
  // auth / account destruction
  'logout', 'log out', 'sign out', 'signout', 'log off', 'switch account',
  'delete', 'deactivate', 'close account', 'remove account', 'reset',
  // generic commit / external escape hatches
  'confirm', 'submit', 'open in', 'external',
  'share', 'whatsapp', 'invite',
];

/** True when a control's identifier/label looks destructive, financial, or app-escaping. */
export function isDestructive(label: string, deny: readonly string[] = DEFAULT_DENY): boolean {
  const s = label.toLowerCase();
  return deny.some((p) => s.includes(p));
}
