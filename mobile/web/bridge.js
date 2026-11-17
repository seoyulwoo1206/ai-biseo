// 각 화면(index · settings · ask · login) 맨 앞에서 실행: window.assistant 를 폰 두뇌에 연결한다.
// - 앱 화면(아이폰 웹앱 · 안드로이드 앱): 바깥 틀(shell)이 만든 두뇌를 같이 쓴다.
// - 안드로이드 떠 있는 캐릭터: overlay-host.js 가 이 창 안에 만든 두뇌를 쓴다.
(function () {
  var page = document.documentElement.getAttribute('data-page') || 'main';
  var be = null;
  try {
    if (window.parent !== window && window.parent.AIBackend) be = window.parent.AIBackend;
  } catch (e) {
    be = null;
  }
  if (!be) be = window.AIBackend;
  if (!be) {
    document.documentElement.setAttribute('data-error', 'no-backend');
    return;
  }
  window.assistant = be.assistantFor(page);
  var cls = document.documentElement.classList;
  cls.add('mobile');
  cls.add('kind-' + window.assistant.platform);
})();
