(function () {
  'use strict';

  var PRICE = 8.99;
  var display = '£' + PRICE.toFixed(2) + ' / month';

  document.getElementById('checkout-form').addEventListener('submit', function (e) {
    e.preventDefault();
    alert('Demo only. In production you would connect to a payment provider (e.g. Stripe).');
  });

  document.getElementById('card-number').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  });

  document.getElementById('card-exp').addEventListener('input', function () {
    var v = this.value.replace(/\D/g, '');
    if (v.length >= 2) {
      this.value = v.slice(0, 2) + '/' + v.slice(2, 4);
    } else {
      this.value = v;
    }
  });
})();
