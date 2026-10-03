# Easy Order — 음성 키오스크

React + Vite 키오스크 한 화면에서 음성 주문과 터치 주문을 함께 사용합니다. 메뉴는 다음/이전 버튼 없이 세로 스크롤로 탐색합니다. 별도 제어 화면, 텍스트 주문 입력, 미리보기 창은 없습니다. 서버가 실행한 **하나의 전체화면 Chromium 키오스크**에서 음성을 받고, JEV가 행동을 판단하고, Playwright가 그 화면의 실제 버튼을 클릭합니다.

## 실행

Node.js 22.12 이상과 pnpm이 필요합니다.

```sh
pnpm install
pnpm exec playwright install chromium
cp .env.example .env # 이미 .env가 있으면 복사하지 말고 필요한 항목만 추가
pnpm dev:agent
```

서버가 준비되면 전체화면 키오스크가 자동으로 실행됩니다. 오른쪽 아래 **음성 주문**을 누르고 마이크 권한을 허용하세요. macOS에서도 Chromium의 마이크 사용 권한이 필요합니다. 음성 기능은 서버가 띄운 이 키오스크 자체에 연결됩니다. 다른 브라우저에서 URL을 열면 터치 주문은 가능하지만 해당 탭의 음성 자동화는 연결되지 않습니다. `/control`은 `/`로 이동합니다.

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
PORT=8787
BROWSER_HEADLESS=false
JEV_MIN_CONFIDENCE=0.5
```

키는 `.env`에만 저장하며 Git에서 제외합니다. `VITE_` 접두사를 붙이지 마세요. ElevenLabs 키에 Speech to Text와 Text to Speech 권한을 부여하고, 계정에서 사용할 수 있는 한국어 음색의 Voice ID를 설정하세요. 환경변수를 바꾸면 서버를 다시 시작합니다. JEV와 ElevenLabs 호출에는 각 서비스 사용량이 발생합니다.

빌드 후 실행: `pnpm build && pnpm start`. `pnpm dev`는 터치 화면만 개발할 때 사용하는 Vite 서버입니다. 전용 키오스크를 다시 열려면 서버를 재시작하세요.

## 음성 흐름

1. 마이크 버튼을 누르면 ElevenLabs Scribe v2 Realtime이 한국어 음성을 인식합니다. 말이 끝나고 약 1.5초간 조용하면 주문을 전달합니다.
2. 인식된 문장이 짧은 자막으로 표시되고 마이크는 닫힙니다. JEV가 메뉴·온도·수량을 판단하고 Playwright가 같은 화면을 클릭합니다.
3. ElevenLabs TTS가 처리 결과나 추가 질문을 읽습니다. 안내가 끝나면 다시 듣습니다. 안내 중에는 마이크가 꺼져 있어 자체 음성의 재입력을 막습니다.
4. 결제 요청은 번호 적립을 건너뛰고 결제수단을 선택한 뒤 금액을 읽고 확인합니다. “네, 진행해 주세요”로 **모의 결제**를 확정하거나 “아니요”로 취소할 수 있습니다. 실제 결제는 수행하지 않습니다.
5. 주문 완료 또는 종료 버튼을 누르면 음성 세션이 종료됩니다. 45초 동안 발화가 없거나 연결 오류가 나면 마이크를 끄고 재시도를 안내합니다. 이미 담긴 주문은 유지합니다.

예: “아이스 아메리카노 두 잔 포장해 줘” → “한 잔으로 바꿔줘” → “카카오페이로 결제해 줘” → “네”. 온도와 잔 수가 빠지면 순서대로 질문합니다. “녹차라떼” → 온도 질문 → “아이스” → 잔 수 질문 → “두 잔”처럼 답하며, 새 주문의 잔 수를 자동으로 1잔으로 정하지 않습니다. 한 번에 세 종류, 항목당 1~20잔을 요청할 수 있습니다. 같은 메뉴의 HOT/ICE가 함께 있으면 수정할 온도를 지정하세요.

STT 초기 구현은 **Scribe v2 Realtime**, TTS는 **Eleven Flash v2.5**입니다. 다른 STT를 선택하면 `src/speech.js`의 `listen` 인터페이스와 서버의 토큰 발급 부분을 교체하면 됩니다.

## 구조

- `src/VoiceOrder.jsx`: 한 화면의 마이크 버튼, 짧은 상태 자막, 듣기/주문/말하기/종료 상태 관리. 모달 안에서도 버튼을 누를 수 있도록 렌더링 위치를 이동합니다.
- `src/speech.js`: ElevenLabs 공식 SDK의 마이크 스트리밍과 TTS 재생. 중단 시 마이크, 소켓, 오디오를 해제합니다.
- `server/speech.js`: 서버 전용 API 키로 일회용 STT 토큰과 TTS 오디오를 발급합니다.
- `server/app.js`: 같은 키오스크 페이지에만 노출한 Playwright binding으로 음성 요청을 받습니다. 다른 탭/프레임은 주문을 실행할 수 없습니다. 기존 HTTP 텍스트 주문 API는 제거했습니다.
- `server/planner.js`: 주문 항목 수와 수량을 분리하고, 실제 메뉴 후보와 장바구니를 기준으로 JEV 선택을 검증합니다.
- `server/runner.js`: JEV의 행동 선택과 작업 대상을 비교하고, 카테고리를 선택하고 메뉴 목록을 스크롤해 메뉴·옵션을 실제 클릭합니다. DOM 변경 또는 주문 불일치 시 중단합니다. 음성 결제 동의 후에도 화면이 바뀌었으면 결제하지 않습니다.
- `server/browser.js`: 전체화면 키오스크 실행, DOM 관찰, 클릭, 변경 검증. React 상태나 장바구니 API를 직접 수정하지 않습니다.

## QA

```sh
pnpm build
pnpm test
pnpm test:e2e
# 실제 JEV 사용량이 발생하는, 인식 이후 주문 처리 확인
pnpm test:live
pnpm test:live --extended
pnpm test:live --options
```

자동 E2E는 실제 Chromium, 마이크 테스트 장치, 공식 STT SDK의 WebSocket 경로, 오디오 재생, 키오스크 클릭을 사용합니다. 외부 STT 인식 결과·TTS 오디오·JEV 판단만 테스트 응답으로 교체합니다. 단일 창 유지, 음성 결제 동의/거부, 중단, 권한 거부, 인증 설정 누락, 오래된 결제 무효화를 확인합니다. 테스트 응답은 운영 코드에 포함되지 않습니다.

`test:live`는 인식 완료 문장을 내부 binding에 주입하여 실제 JEV와 Playwright를 검사하는 개발 스크립트입니다. 사용자용 텍스트 입력 기능이 아니며, STT 인식률이나 TTS 음질을 검증하지 않습니다. 실제 음성 품질은 ElevenLabs 키와 Voice ID 설정 후 매장 소음 환경에서 마이크·스피커로 확인해야 합니다. 테스트 캡처는 Git에서 제외된 `artifacts/`에 저장합니다.

공식 문서: [Scribe SDK](https://elevenlabs.io/docs/eleven-api/resources/libraries/scribe-stt/javascript-scribe) · [ElevenLabs TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) · [JEV](https://docs.typesafe.ai/introduction/quickstart) · [Playwright](https://playwright.dev/docs/locators)
