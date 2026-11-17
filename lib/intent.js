// "물어보기"에 들어온 말을 알아듣는다. (인터넷·AI 없이 비서가 직접 처리하는 것들)
// 결과: { type, ... } — main.js 가 type 에 따라 실제로 실행한다.

const NUM_WORDS = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
  열: 10, 스무: 20, 스물: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60,
};

// "1시간 30분", "90분", "30초", "한 시간 반", "반 시간" → 초
function parseDuration(text) {
  const t = text.replace(/\s+/g, '');
  let sec = 0;
  let found = false;
  const num = (s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NUM_WORDS[s]);
  const h = t.match(/(\d+(?:\.\d+)?|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)시간(반)?/);
  if (h) {
    sec += num(h[1]) * 3600 + (h[2] ? 1800 : 0);
    found = true;
  }
  const m = t.match(/(\d+|[가-힣]+?)분/);
  if (m && num(m[1]) != null) {
    sec += num(m[1]) * 60;
    found = true;
  }
  const s = t.match(/(\d+|[가-힣]+?)초/);
  if (s && num(s[1]) != null) {
    sec += num(s[1]);
    found = true;
  }
  return found && sec > 0 ? sec : null;
}

const HOUR_WORDS = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12,
};

// "내일 아침 7시 반", "오후 3시 20분", "15시" → { hour, minute, part, dayOffset }
function parseClock(text) {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(/(\d{1,2}|열두|열한|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (!m) return null;
  const hour = /^\d+$/.test(m[1]) ? Number(m[1]) : HOUR_WORDS[m[1]];
  const minute = m[2] === '반' ? 30 : m[3] ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59) return null;
  const before = t.slice(0, m.index);
  let part = null;
  if (/(새벽|아침|오전)/.test(before)) part = 'am';
  else if (/(낮|오후|저녁|밤)/.test(before)) part = 'pm';
  let dayOffset = 0;
  if (/모레/.test(before)) dayOffset = 2;
  else if (/내일/.test(before)) dayOffset = 1;
  return { hour, minute, part, dayOffset, rest: t.slice(m.index + m[0].length) };
}

// 시각 → 실제 날짜 (오전/오후를 안 말하면 가장 가까운 다음 시각)
function alarmDate(c, now = new Date()) {
  const at = (h) => {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setDate(d.getDate() + c.dayOffset);
    d.setHours(h, c.minute);
    return d;
  };
  let candidates;
  if (c.hour >= 13 || c.hour === 0) candidates = [at(c.hour)];
  else if (c.part === 'am') candidates = [at(c.hour % 12)];
  else if (c.part === 'pm') candidates = [at((c.hour % 12) + 12)];
  else if (c.hour === 12) candidates = [at(12)]; // "12시"는 보통 낮 12시
  else candidates = [at(c.hour % 12), at((c.hour % 12) + 12)];
  let best = candidates.filter((d) => d > now).sort((a, b) => a - b)[0];
  if (!best) {
    // 오늘은 이미 지났으면 내일 같은 시각
    best = new Date(candidates.sort((a, b) => a - b)[0]);
    best.setDate(best.getDate() + 1);
  }
  return best;
}

function clean(text) {
  return text
    .trim()
    .replace(/[?？!！.。~]+$/g, '')
    .trim();
}

// 검색어 정리: "고양이 사료 검색해줘" → "고양이 사료"
function searchQuery(text) {
  return clean(text)
    .replace(/(을|를)?\s*(네이버|구글|유튜브)?(에서|로)?\s*(검색|찾아)\s*(해\s*줘|해\s*줄래|줘|줄래|해|좀|봐)?$/, '')
    .replace(/^(네이버|구글|유튜브)(에서|로)\s*/, '')
    .trim();
}

function parse(input) {
  const text = clean(input || '');
  const t = text.replace(/\s+/g, '');
  if (!t) return { type: 'empty' };

  // 화면 봐 주기 ("이 화면 봐줘", "화면에 이거 뭐야", "이 문제 풀어줘")
  if (
    (/(화면|스크린|모니터|스샷|캡처|캡쳐)/.test(t) && /(봐|보고|보여|분석|설명|읽어|알려|뭐|해석|풀어|번역|요약|어때|도와|찍어|확인|고쳐)/.test(t)) ||
    /^(이|요|이거)?문제(좀)?(풀어|알려|설명|해설|어떻게)/.test(t) ||
    /^(이거|이것|요거)(좀)?(봐줘|봐봐|풀어줘|번역해줘|해석해줘|요약해줘)/.test(t) ||
    // "이 오류 뭐야", "이 에러 어떻게 고쳐"
    /^(이|요|저|이거)?(오류|에러|경고|에러메시지|오류메시지)(가|는|좀)?(뭐|왜|어떻게|해결|고쳐|고치|알려|봐|무슨)/.test(t) ||
    // "이 부분만 요약해줘", "여기 영역 번역해줘"
    /^(이|요|저|여기)?(부분|영역)(만)?(좀)?(요약|번역|해석|설명|봐|풀어|알려|읽어|정리)/.test(t) ||
    // "지금 창 설명해줘", "이 창만 번역해줘"
    /^(지금|이|요)창(만)?(좀|에)?(설명|요약|번역|해석|봐|알려|뭐|정리|읽어)/.test(t)
  ) {
    return { type: 'screen', query: text };
  }

  // 타이머 멈추기
  if (/(타이머|집중|뽀모도로).*(그만|멈춰|끝|취소|중지|꺼)/.test(t) || /^(그만|멈춰|취소)$/.test(t)) {
    return { type: 'timer-stop' };
  }

  // 할 일 추가: "수학 숙제 추가해줘", "내일 영어 단어 할 일 추가", "할 일 추가 화학 복습", "공부에 화학 복습 넣어줘"
  const addEnds = /(추가|넣어|등록|적어)(해|해서)?(줘|줄래|주세요|둬|놔)?$/.test(t);
  const addStarts = /^(오늘|내일|낼|모레)?(할일|투두)(에|로)?(추가|등록)/.test(t);
  if ((addEnds || addStarts) && !/(알람|타이머)/.test(t)) {
    let rest = text.trim();
    let dayOffset = 0;
    const day = rest.match(/^(오늘|내일|낼|모레)\s*/);
    if (day) {
      dayOffset = { 오늘: 0, 내일: 1, 낼: 1, 모레: 2 }[day[1]];
      rest = rest.slice(day[0].length);
    }
    rest = rest
      .replace(/^(할\s*일|할일|투두)\s*(에|로|으로)?\s*(추가|등록)?\s*(해\s*줘|해줘|해)?\s*[:：]?\s*/, '')
      .replace(/\s*(을|를)?\s*(할\s*일|할일|투두)?\s*(에|로|으로)?\s*(추가|넣어|등록|적어)\s*(해|해서)?\s*(줘|줄래|주세요|둬|놔)?\s*$/, '')
      .replace(/\s*(을|를)\s*$/, '')
      .trim();
    return { type: 'todo-add', title: rest, dayOffset }; // 이름이 비어 있으면 "뭘 추가할까?" 하고 되묻는다
  }

  // 알람 목록 / 끄기
  if (/알람/.test(t) && /(목록|뭐|몇개|있어|확인|보여)/.test(t)) return { type: 'alarm-list' };
  if (/알람/.test(t) && /(다|모두|전부)?(꺼|끄|취소|지워|없애|삭제)/.test(t)) return { type: 'alarm-clear' };

  // "7시에 알람", "내일 아침 7시에 깨워줘", "오후 3시 반에 학원 알려줘"
  if (/(알람|깨워|알려|말해|불러)/.test(t) && !/(분|시간|초|반)(뒤|후|있다가)/.test(t)) {
    const c = parseClock(text);
    if (c) {
      const what = c.rest
        .replace(/^\s*에\s*/, '')
        .replace(/\s*(알람|깨워|알려|말해|불러).*$/, '')
        .replace(/\s*(맞춰|맞춰줘|설정|해줘|좀)\s*$/g, '')
        .replace(/(이|가|을|를)\s*$/, '')
        .trim();
      return { type: 'alarm', clock: { hour: c.hour, minute: c.minute, part: c.part, dayOffset: c.dayOffset }, what };
    }
  }

  // "10분 뒤에 빨래 알려줘" / "30분 후에 알려줘"
  const later = text.match(/^(.+?)\s*(뒤|후|있다가)에?\s*(.*?)\s*(알려\s*줘|알려줄래|알려|깨워\s*줘|말해\s*줘|불러\s*줘)?$/);
  if (later && /(알려|깨워|말해|불러|알람)/.test(t)) {
    const sec = parseDuration(later[1]);
    if (sec) {
      const what = (later[3] || '').replace(/\s*알람\s*(맞춰|해)?\s*$/, '').replace(/(이|가|을|를)?\s*$/, '').trim();
      return { type: 'remind', seconds: sec, what: what || '말한 시간' };
    }
  }

  // "집중 시간 45분으로 바꿔줘", "기본 집중 50분으로 해줘" → 기본 집중 시간만 바꾸기
  if (/집중(시간|타이머)?.*(으로|로).*(바꿔|바꾸|설정|정해|맞춰|해줘|해둬|해놔|변경)/.test(t) || /^(기본)집중/.test(t)) {
    const sec = parseDuration(text);
    if (sec) return { type: 'focus-set', seconds: sec };
  }

  // "25분 타이머", "집중 50분", "뽀모도로", "집중 시작"(시간 없으면 설정한 기본 집중 시간)
  if (/(타이머|집중|뽀모도로|공부|스톱워치)/.test(t)) {
    const sec = parseDuration(text);
    if (/뽀모도로/.test(t) && !sec) return { type: 'focus', seconds: 25 * 60 };
    if (sec) return { type: /(집중|공부|뽀모도로)/.test(t) ? 'focus' : 'timer', seconds: sec };
    if (/(집중|공부)/.test(t)) return { type: 'focus', seconds: null };
  }

  // "카톡 열어줘", "크롬 켜", "계산기 실행해", "유튜브 틀어줘"
  const open = text.match(/^(.+?)\s*(?:좀\s*)?(?:열어|켜|실행해|실행|틀어|띄워)\s*(?:줘|줄래|봐|라|주세요)?$/);
  if (open && !/(에서|로)\s/.test(open[1] + ' ')) {
    const name = open[1].replace(/\s*(을|를|좀|앱|어플|프로그램)\s*$/g, '').replace(/\s*(을|를)\s*$/, '').trim();
    if (/^(타이머|알람|집중|뽀모도로|스톱워치)$/.test(name)) return { type: 'need-time', what: name };
    if (name) return { type: 'open', name };
  }
  const openIn = text.match(/^(유튜브|네이버|구글)에서\s*(.+?)\s*(?:틀어|찾아|검색해|보여)\s*(?:줘|줄래)?$/);
  if (openIn) return { type: 'search', engine: { 유튜브: 'youtube', 네이버: 'naver', 구글: 'google' }[openIn[1]], query: openIn[2] };

  // 검색 ("~ 검색해줘", "네이버에서 ~")
  if (/(검색|찾아)/.test(t) || /^(네이버|구글|유튜브)(에서|로)/.test(t)) {
    let engine = 'naver';
    if (/구글/.test(t)) engine = 'google';
    if (/유튜브/.test(t)) engine = 'youtube';
    const q = searchQuery(text);
    if (q) return { type: 'search', engine, query: q };
  }

  if (/(몇시|지금시간|시간알려|현재시간)/.test(t)) return { type: 'time' };
  if (/(며칠|몇월|무슨요일|오늘날짜|날짜)/.test(t)) return { type: 'date' };
  if (/(일정|할일|할거|스케줄|해야할|숙제뭐)/.test(t)) return { type: 'today' };
  if (/(날씨|우산|미세먼지|기온|몇도|비와|비올|비오|눈와|눈올|추워|더워|추울|더울)/.test(t)) {
    return { type: 'weather', when: /(내일|낼)/.test(t) ? 'tomorrow' : 'today' };
  }
  if (/(브리핑|하루요약|오늘요약|오늘어때)/.test(t)) return { type: 'brief' };
  if (/^(안녕|하이|헬로|ㅎㅇ|반가워)/.test(t)) return { type: 'hello' };
  if (/(사랑해|귀여워|예뻐|최고|좋아해)/.test(t)) return { type: 'love' };
  if (/(심심|놀아줘|춤)/.test(t)) return { type: 'dance' };
  if (/(고마워|감사)/.test(t)) return { type: 'thanks' };
  if (/(피곤|힘들|졸려|지쳐)/.test(t)) return { type: 'tired' };
  if (/(뭐할수있|도움말|기능|할수있는)/.test(t)) return { type: 'help' };

  // "블랙홀이 뭐야", "세종대왕 누구야", "광합성 뜻", "임진왜란에 대해 알려줘" → 위키백과로 찾아보기
  const ask = text.match(
    /^(.+)\s*(?:뭐야|뭔데|뭐지|뭐예요|뭐에요|뭐임|무엇인가요|무엇이야|누구야|누구지|누구예요|누구에요|누구임|뜻이\s*뭐야|뜻|에\s*대해\s*(?:알려\s*줘|설명해\s*줘|말해\s*줘)|(?:알려|설명해)\s*줘)$/,
  );
  if (ask) {
    let topic = ask[1]
      .trim()
      .replace(/\s*(?:의|에\s*대해)$/, '')
      .trim();
    if (/^(너|넌|니|너는|당신)$/.test(topic)) return { type: 'me' };
    if (topic && !/^(이거|그거|저거|이게|그게|뭐|무엇|오늘|지금|나|내|이건|그건)$/.test(topic)) {
      // 붙어 있는 조사 떼기. 가·은·는은 거의 항상 조사라 먼저 떼고 찾고,
      // 이·란은 고양이·임진왜란처럼 낱말 끝일 수도 있어서 그대로 먼저 찾은 뒤 떼고 한 번 더 찾는다.
      const p = topic.match(/^(.{2,}?)\s*(이란|란|가|은|는|이)$/);
      let topics = [topic];
      if (p) topics = /^(가|은|는)$/.test(p[2]) ? [p[1].trim(), topic] : [topic, p[1].trim()];
      return { type: 'wiki', topic: topics[0], topics, query: text };
    }
  }

  // 계산 "12*34", "3+4는"
  const calc = t.replace(/(는|은|이야|얼마|이에요|일까|계산해줘|계산)$/g, '').replace(/[x×]/g, '*').replace(/÷/g, '/');
  if (/^[\d.+\-*/()%]+$/.test(calc) && /[+\-*/%]/.test(calc)) {
    try {
      // 숫자와 연산자만 남겼으므로 안전하게 계산할 수 있다
      const v = Function(`"use strict"; return (${calc});`)();
      if (Number.isFinite(v)) return { type: 'calc', expr: calc, value: Math.round(v * 1e8) / 1e8 };
    } catch {
      /* 계산 못 하면 아래로 */
    }
  }

  return { type: 'unknown', query: text };
}

function searchUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === 'google') return `https://www.google.com/search?q=${q}`;
  if (engine === 'youtube') return `https://www.youtube.com/results?search_query=${q}`;
  return `https://search.naver.com/search.naver?query=${q}`;
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : '', s && !h ? `${s}초` : ''].filter(Boolean).join(' ') || '0초';
}

module.exports = { parse, parseDuration, parseClock, alarmDate, searchUrl, formatDuration };
