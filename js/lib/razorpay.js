/**
 * Razorpay — loads the hosted checkout script on demand.
 *
 * Only the checkout page pays for this script, and only when the shopper is
 * actually ready to pay.
 */

var SRC = 'https://checkout.razorpay.com/v1/checkout.js';
var pending = null;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  if (!pending) {
    pending = new Promise(function (resolve, reject) {
      var script = document.createElement('script');

      script.src = SRC;
      script.async = true;
      script.onload = function () {
        if (window.Razorpay) resolve(window.Razorpay);
        else reject(new Error('Razorpay loaded but did not initialise.'));
      };
      script.onerror = function () {
        pending = null;
        reject(new Error('Could not reach the payment provider.'));
      };

      document.head.append(script);
    });
  }

  return pending;
}
