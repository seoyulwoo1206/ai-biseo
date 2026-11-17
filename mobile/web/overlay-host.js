// 안드로이드: 다른 앱 위에 떠 있는 캐릭터 창. 두뇌를 이 창 안에 만들고,
// 창 크기·위치 바꾸기와 앱 열기는 AndroidBridge(자바 쪽)에 맡긴다.
(function () {
  var native = window.AndroidBridge;
  if (!native) return;
  var host = {
    kind: 'android-overlay',
    native: native,
    // 설정·물어보기·로그인은 앱 화면을 열어서 보여 준다
    openSheet: function (name) {
      native.showApp(name || '');
    },
    closeSheet: function () {},
    toggleSheet: function (name) {
      native.showApp(name || '');
    },
    // 말풍선이 떠 있으면 창을 크게, 캐릭터만 있으면 캐릭터 크기로 (나머지 화면은 뒤쪽 앱이 터치를 받는다)
    setShape: function (rects) {
      native.setShape(JSON.stringify(rects || []));
    },
    dragStart: function () {
      native.dragStart();
    },
    dragBy: function (dx, dy) {
      return native.moveBy(dx, dy);
    },
    dragMove: function () {},
    dragEnd: function () {
      native.dragEnd();
    },
  };
  window.AIBackend = window.createAIBackend(host);
  window.addEventListener('load', function () {
    window.AIBackend.start();
  });
})();
