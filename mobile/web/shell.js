// 앱 틀 (아이폰 웹앱 · 안드로이드 앱 화면): 캐릭터 무대 + 설정·물어보기·로그인 바텀 시트
(function () {
  var native = window.AndroidBridge || null;
  var kind = native ? 'android-app' : 'pwa';
  var $ = function (id) {
    return document.getElementById(id);
  };
  var scrim = $('scrim');
  var SHEETS = {
    settings: { src: 'settings.html' },
    ask: { src: 'ask.html' },
    login: { src: 'login.html', small: true },
  };
  var openName = null;

  function sheetEl(name) {
    var s = SHEETS[name];
    if (!s.el) {
      var sec = document.createElement('section');
      sec.className = 'sheet' + (s.small ? ' small' : '');
      sec.id = 'sheet-' + name;
      var frame = document.createElement('iframe');
      frame.title = name;
      frame.src = s.src;
      sec.append(frame);
      document.body.append(sec);
      s.el = sec;
      // 처음 만들 때는 한 박자 뒤에 올려야 미끄러지는 애니메이션이 보인다
      sec.getBoundingClientRect();
    }
    return s.el;
  }

  var host = {
    kind: kind,
    native: native,
    openSheet: function (name) {
      if (!SHEETS[name]) return;
      if (openName && openName !== name) host.closeSheet(openName);
      var el = sheetEl(name);
      requestAnimationFrame(function () {
        el.classList.add('on');
      });
      scrim.classList.add('on');
      openName = name;
      if (name === 'settings') {
        window.AIBackend.settingsState().then(function (s) {
          window.AIBackend.emit('settings:update', s);
        });
      }
      if (name === 'ask') setTimeout(window.AIBackend.focusAsk, 300);
    },
    closeSheet: function (name) {
      var s = SHEETS[name];
      if (s && s.el) s.el.classList.remove('on');
      if (openName === name || !name) {
        openName = null;
        scrim.classList.remove('on');
      }
    },
    toggleSheet: function (name) {
      if (openName === name) host.closeSheet(name);
      else host.openSheet(name);
    },
  };

  window.AIBackend = window.createAIBackend(host);

  // 캐릭터 무대는 두뇌를 만든 다음에 띄운다 (무대가 두뇌에 연결하므로)
  var stage = document.createElement('iframe');
  stage.title = '캐릭터';
  stage.src = 'stage.html';
  stage.setAttribute('allowtransparency', 'true');
  stage.addEventListener('load', function () {
    window.AIBackend.start();
  });
  $('stageHost').append(stage);

  scrim.addEventListener('click', function () {
    if (openName) host.closeSheet(openName);
  });
  $('bSet').addEventListener('click', function () {
    host.toggleSheet('settings');
  });
  $('bAsk').addEventListener('click', function () {
    host.toggleSheet('ask');
  });
  $('bToday').addEventListener('click', function () {
    if (openName) host.closeSheet(openName);
    window.AIBackend.showToday();
  });

  // 안드로이드: 다른 앱 위에 띄우기
  if (native && native.setOverlay) {
    $('bFloat').classList.remove('hidden');
    $('bFloat').addEventListener('click', function () {
      native.setOverlay(true);
    });
  }
  // 안드로이드 뒤로 가기: 열린 시트부터 닫는다 (true 를 돌려주면 앱이 닫히지 않음)
  window.__aibiseoBack = function () {
    if (openName) {
      host.closeSheet(openName);
      return true;
    }
    return false;
  };
  // 안드로이드: 떠 있는 캐릭터를 눌러서 앱을 열면 바로 그 화면으로
  window.__aibiseoOpen = function (name) {
    if (name && SHEETS[name]) host.openSheet(name);
  };

  // 아이폰 웹앱: 알림 허락 받기, 홈 화면 추가 안내
  if (!native) {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    var standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && standalone) {
      $('bNotify').classList.remove('hidden');
      $('bNotify').addEventListener('click', function () {
        Notification.requestPermission().then(function () {
          $('bNotify').classList.add('hidden');
        });
      });
    }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var dismissed = false;
    try {
      dismissed = localStorage.getItem('aibiseo.installHint') === 'off';
    } catch (e) {
      dismissed = false;
    }
    if (ios && !standalone && !dismissed) {
      $('install').classList.remove('hidden');
      $('installClose').addEventListener('click', function () {
        $('install').classList.add('hidden');
        try {
          localStorage.setItem('aibiseo.installHint', 'off');
        } catch (e) {
          /* 무시 */
        }
      });
    }
  }

  // ?open=settings 같이 열면 그 화면부터 (안드로이드 떠 있는 캐릭터에서 넘어올 때)
  var want = new URLSearchParams(location.search).get('open');
  if (want) setTimeout(function () {
    host.openSheet(want);
  }, 400);
})();
