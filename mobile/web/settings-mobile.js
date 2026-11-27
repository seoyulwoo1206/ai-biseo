// 폰용 설정 화면 다듬기: PC 에만 있는 항목은 숨기고, 폰에만 있는 항목(화면 위에 띄우기)을 넣는다.
(function () {
  var api = window.assistant;
  if (!api) return;
  var kind = api.platform;
  var android = kind === 'android-app' || kind === 'android-overlay';
  var $ = function (id) {
    return document.getElementById(id);
  };
  function rowOf(el) {
    return el && (el.closest('label') || el.closest('.row'));
  }
  function hide(el) {
    if (el) el.style.display = 'none';
  }

  // PC 전용: 폴더 열기, 딴짓 말리기(창 감지)
  hide($('folder'));
  hide(rowOf($('focusGuard')));
  // 학교: 내 나이스 키 넣기는 PC 에서만 (폰은 우리 서버 키로 7교시까지)
  hide($('neisToggle') && $('neisToggle').closest('.links'));
  hide($('neisForm'));
  var size = $('size');
  if (size && size.previousElementSibling) size.previousElementSibling.textContent = '크기';

  // 자동 실행: 안드로이드는 "폰 켤 때 캐릭터 띄우기", 아이폰은 숨김
  var auto = $('autostart');
  if (android) {
    var span = rowOf(auto) && rowOf(auto).querySelector('span');
    if (span) span.textContent = '폰 켤 때 캐릭터 띄우기';
  } else hide(rowOf(auto));

  // 안드로이드: 다른 앱 위에 캐릭터 띄우기 스위치
  if (android && auto) {
    var label = document.createElement('label');
    label.className = 'row between switch-row';
    var text = document.createElement('span');
    text.innerHTML = '화면 위에 떠 있기 <small class="hint">다른 앱 쓸 때도</small>';
    var sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'switch';
    sw.id = 'overlay';
    label.append(text, sw);
    rowOf(auto).before(label);
    sw.addEventListener('change', function () {
      api.settings.toggle('overlay', sw.checked);
    });
    var paint = function (s) {
      if (s) sw.checked = !!s.overlay;
    };
    api.settings.get().then(paint);
    api.settings.onUpdate(paint);
  }

  // 끄기 버튼: 안드로이드만 (떠 있는 캐릭터 끄기)
  var quit = $('quit');
  if (!android) hide(quit && quit.closest('footer'));
  else if (quit) quit.textContent = '떠 있는 캐릭터 끄기';
})();
