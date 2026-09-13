/**
 * Money — display helpers. Amounts are integers in paise everywhere else.
 */

var formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

/** 249000 -> "₹2,490" */
export function formatPaise(paise) {
  return formatter.format(Math.round(paise / 100));
}
