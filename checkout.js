(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var planFromUrl = params.get('plan') || 'family';

  var planSelector = document.getElementById('plan-selector');
  var planOptions = document.querySelectorAll('.plan-option');

  var plans = {
    freelance: { name: 'Freelance Plan', price: 6.99 },
    family: { name: 'Family Plan', price: 14.99 },
    'small-business': { name: 'Small Business Plan', price: 24.99 }
  };

  function updateSummary() {
    var selected = document.querySelector('.plan-option.selected');
    if (!selected) return;
    var planId = selected.dataset.plan;
    var plan = plans[planId];
    if (!plan) return;

    var display = '£' + plan.price.toFixed(2) + ' / month';
    var subtotal = '£' + plan.price.toFixed(2) + ' / month';

    document.getElementById('summary-plan-name').textContent = plan.name;
    document.getElementById('summary-plan-period').textContent = 'Monthly billing';
    document.getElementById('summary-subtotal').textContent = subtotal;
    document.getElementById('summary-tax').textContent = '£0';
    document.getElementById('summary-total').textContent = display;
    document.getElementById('summary-cta-total').textContent = display;
  }

  function selectPlan(planId) {
    planOptions.forEach(function (opt) {
      opt.classList.toggle('selected', opt.dataset.plan === planId);
    });
    updateSummary();
  }

  planOptions.forEach(function (opt) {
    opt.addEventListener('click', function () {
      selectPlan(opt.dataset.plan);
    });
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'plan';
    input.value = opt.dataset.plan;
    opt.prepend(input);
  });

  selectPlan(planFromUrl);

  document.getElementById('checkout-form').addEventListener('submit', function (e) {
    e.preventDefault();
    alert('This is a demo. In production you would connect to a payment provider (e.g. Stripe).');
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
