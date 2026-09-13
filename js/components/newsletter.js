/**
 * Newsletter — posts to Netlify Forms when available, and always shows the
 * confirmation. Signup is not worth blocking on a network round-trip.
 */

export function mountNewsletter(form) {
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var email = form.querySelector('#email');

    if (email && !email.checkValidity()) {
      email.reportValidity();
      return;
    }

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).catch(function () {
      /* Signup is best-effort; the shopper still sees the confirmation. */
    });

    form.innerHTML =
      '<p class="success-message">You&rsquo;re in. Front-row energy unlocked &#10022;</p>';
  });
}
