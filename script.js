(function () {
  'use strict';

  var menuToggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.nav');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      menuToggle.classList.toggle('open');
    });
  }
})();
