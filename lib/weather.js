// 날씨·미세먼지 (Open-Meteo: 무료, 키 필요 없음)
// 위치는 설정에서 고른 동네의 위도·경도만 보낸다. (기본: 서울)

const DEFAULT_PLACE = { name: '서울', admin: '서울특별시', lat: 37.5665, lon: 126.978 };

// WMO 날씨 코드 → 말·이모지
function describe(code, isDay = 1) {
  if (code === 0) return { desc: '맑음', emoji: isDay ? '☀️' : '🌙' };
  if (code === 1) return { desc: '대체로 맑음', emoji: isDay ? '🌤️' : '🌙' };
  if (code === 2) return { desc: '구름 조금', emoji: '⛅' };
  if (code === 3) return { desc: '흐림', emoji: '☁️' };
  if (code === 45 || code === 48) return { desc: '안개', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { desc: '이슬비', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { desc: code >= 65 ? '비 많이' : '비', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { desc: '눈', emoji: '❄️' };
  if (code >= 80 && code <= 82) return { desc: '소나기', emoji: '🌦️' };
  if (code === 85 || code === 86) return { desc: '눈 소나기', emoji: '🌨️' };
  if (code >= 95) return { desc: '천둥번개', emoji: '⛈️' };
  return { desc: '알 수 없음', emoji: '🌡️' };
}

// 우리나라 미세먼지 기준
function dustGrade(pm10, pm25) {
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 0 : pm10 <= 80 ? 1 : pm10 <= 150 ? 2 : 3;
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 0 : pm25 <= 35 ? 1 : pm25 <= 75 ? 2 : 3;
  const g = Math.max(g10, g25);
  return [
    { label: '좋음', emoji: '😊' },
    { label: '보통', emoji: '🙂' },
    { label: '나쁨', emoji: '😷' },
    { label: '매우 나쁨', emoji: '🤢' },
  ][g];
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`날씨 서버 오류 (${res.status})`);
  return res.json();
}

let cache = { key: '', at: 0, data: null };

async function get(place = DEFAULT_PLACE) {
  const key = `${place.lat},${place.lon}`;
  if (cache.key === key && Date.now() - cache.at < 15 * 60 * 1000) return cache.data;
  const q = `latitude=${place.lat}&longitude=${place.lon}&timezone=Asia%2FSeoul`;
  const [w, air] = await Promise.all([
    getJson(
      `https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,weather_code,is_day` +
        '&hourly=temperature_2m,precipitation_probability,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2',
    ),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=pm10,pm2_5`).catch(() => null),
  ]);

  const c = w.current;
  const day = (i) => ({
    max: Math.round(w.daily.temperature_2m_max[i]),
    min: Math.round(w.daily.temperature_2m_min[i]),
    rain: w.daily.precipitation_probability_max[i] ?? 0,
    ...describe(w.daily.weather_code[i], 1),
  });

  // 앞으로 12시간 안에 비 올 확률이 높은 첫 시간
  const nowHour = c.time.slice(0, 13);
  const start = Math.max(0, w.hourly.time.findIndex((t) => t.slice(0, 13) === nowHour));
  let rainSoon = null;
  for (let i = start; i < Math.min(start + 12, w.hourly.time.length); i++) {
    const p = w.hourly.precipitation_probability[i];
    if (p >= 60) {
      rainSoon = { hour: Number(w.hourly.time[i].slice(11, 13)), prob: p, inHours: i - start };
      break;
    }
  }

  // 자세히 보기용: 지금부터 2시간 간격으로 12시간
  const hours = [];
  for (let i = start; i < Math.min(start + 13, w.hourly.time.length); i += 2) {
    hours.push({
      hour: Number(w.hourly.time[i].slice(11, 13)),
      temp: Math.round(w.hourly.temperature_2m[i]),
      rain: w.hourly.precipitation_probability[i] ?? 0,
      ...describe(w.hourly.weather_code[i], Number(w.hourly.time[i].slice(11, 13)) >= 6 && Number(w.hourly.time[i].slice(11, 13)) < 19 ? 1 : 0),
    });
  }

  const pm10 = air && air.current ? air.current.pm10 : null;
  const pm25 = air && air.current ? air.current.pm2_5 : null;
  const data = {
    place: place.name,
    now: { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), ...describe(c.weather_code, c.is_day) },
    today: day(0),
    tomorrow: day(1),
    rainSoon,
    hours,
    dust: pm10 == null && pm25 == null ? null : { pm10: Math.round(pm10), pm25: Math.round(pm25), ...dustGrade(pm10, pm25) },
  };
  cache = { key, at: Date.now(), data };
  return data;
}

// 한 줄 조언 (옷차림·우산·마스크)
function advice(w) {
  const tips = [];
  if (w.rainSoon) tips.push(w.rainSoon.inHours <= 0 ? '지금 비 올 수 있어, 우산 챙겨 ☂️' : `${w.rainSoon.hour}시쯤 비 소식, 우산 챙겨 ☂️`);
  else if (w.today.rain >= 50) tips.push('오늘 비 올 수도 있어, 우산 챙기면 좋아 ☂️');
  if (w.dust && /나쁨/.test(w.dust.label)) tips.push('미세먼지 나빠, 마스크 써 😷');
  const t = w.now.feels;
  if (t <= 0) tips.push('엄청 추워, 패딩 필수 🧣');
  else if (t <= 8) tips.push('쌀쌀해, 따뜻하게 입어 🧥');
  else if (t >= 28) tips.push('더워, 물 자주 마셔 💧');
  if (w.today.max - w.today.min >= 10) tips.push('일교차 커, 겉옷 챙겨');
  return tips.slice(0, 2).join(' · ') || '나가기 좋은 날씨야 🍀';
}

// 자주 쓰는 도시·구 (온라인 검색이 한국 지명을 잘 못 찾을 때가 있어서 먼저 본다)
const KNOWN = [
  ['서울', '서울특별시', 37.5665, 126.978], ['부산', '부산광역시', 35.1796, 129.0756], ['대구', '대구광역시', 35.8714, 128.6014],
  ['인천', '인천광역시', 37.4563, 126.7052], ['광주', '광주광역시', 35.1595, 126.8526], ['대전', '대전광역시', 36.3504, 127.3845],
  ['울산', '울산광역시', 35.5384, 129.3114], ['세종', '세종특별자치시', 36.4801, 127.289], ['수원', '경기도', 37.2636, 127.0286],
  ['성남', '경기도', 37.42, 127.1267], ['분당', '경기도 성남시', 37.3826, 127.119], ['용인', '경기도', 37.2411, 127.1776],
  ['고양', '경기도', 37.6584, 126.832], ['부천', '경기도', 37.5034, 126.766], ['안산', '경기도', 37.3219, 126.8309],
  ['안양', '경기도', 37.3943, 126.9568], ['화성', '경기도', 37.1996, 126.8312], ['평택', '경기도', 36.9921, 127.1129],
  ['의정부', '경기도', 37.7381, 127.0337], ['파주', '경기도', 37.7599, 126.7802], ['김포', '경기도', 37.6153, 126.7156],
  ['남양주', '경기도', 37.636, 127.2165], ['시흥', '경기도', 37.3799, 126.8031], ['하남', '경기도', 37.5393, 127.2148],
  ['광명', '경기도', 37.4786, 126.8644], ['춘천', '강원특별자치도', 37.8813, 127.7298], ['원주', '강원특별자치도', 37.3422, 127.9202],
  ['강릉', '강원특별자치도', 37.7519, 128.8761], ['청주', '충청북도', 36.6424, 127.489], ['천안', '충청남도', 36.8151, 127.1139],
  ['전주', '전북특별자치도', 35.8242, 127.148], ['목포', '전라남도', 34.8118, 126.3922], ['여수', '전라남도', 34.7604, 127.6622],
  ['순천', '전라남도', 34.9507, 127.4872], ['포항', '경상북도', 36.019, 129.3435], ['경주', '경상북도', 35.8562, 129.2247],
  ['구미', '경상북도', 36.1195, 128.3446], ['안동', '경상북도', 36.5684, 128.7294], ['창원', '경상남도', 35.228, 128.6811],
  ['김해', '경상남도', 35.2285, 128.8894], ['진주', '경상남도', 35.18, 128.1076], ['제주', '제주특별자치도', 33.4996, 126.5312],
  ['서귀포', '제주특별자치도', 33.2541, 126.56], ['강남구', '서울특별시', 37.5172, 127.0473], ['송파구', '서울특별시', 37.5145, 127.1059],
  ['마포구', '서울특별시', 37.5663, 126.9019], ['노원구', '서울특별시', 37.6542, 127.0568], ['관악구', '서울특별시', 37.4784, 126.9516],
  ['강서구', '서울특별시', 37.5509, 126.8495], ['서초구', '서울특별시', 37.4837, 127.0324], ['종로구', '서울특별시', 37.5735, 126.979],
].map(([name, admin, lat, lon]) => ({ name, admin, lat, lon }));

// 동네 검색 (우리나라만). "부산"보다 "부산광역시"가 잘 찾아져서 여러 꼴로 같이 찾아 본다.
async function searchPlace(name) {
  name = String(name || '').trim();
  if (!name) return [];
  const key = name.replace(/\s+/g, '').replace(/(특별시|광역시|특별자치시|특별자치도|시|군)$/, '');
  const known = KNOWN.filter((k) => k.name === key || k.name === `${key}구` || k.name.replace(/구$/, '') === key);
  if (known.length) return known;
  const base = name.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구)$/, '');
  const tries = [...new Set([name, `${base}시`, `${base}광역시`, `${base}특별시`, `${base}구`, `${base}군`])];
  const lists = await Promise.all(
    tries.map((n) =>
      getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(n)}&count=5&language=ko&countryCode=KR`)
        .then((j) => j.results || [])
        .catch(() => []),
    ),
  );
  const seen = new Set();
  return lists
    .flat()
    .filter((r) => {
      const k = `${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.population || 0) - (a.population || 0))
    .slice(0, 5)
    .map((r) => ({ name: r.name, admin: r.admin1 || '', lat: r.latitude, lon: r.longitude }));
}

module.exports = { get, advice, searchPlace, describe, DEFAULT_PLACE };
