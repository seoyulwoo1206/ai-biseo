// Vercel CLI 가 컴퓨터 이름(한글)을 HTTP 헤더에 넣다가 멈춰서, 이 실행에서만 영어 이름으로 바꿔 준다.
require('os').hostname = () => 'windows-pc';
