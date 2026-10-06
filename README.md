# 🧊 이유식 큐브

이유식 큐브 재고 관리 + 식단/레시피 추천 웹앱 (2026-02-25생 아기 기준, 설정에서 변경 가능)

## 기능

| # | 기능 | 위치 |
|---|---|---|
| 1 | 큐브 등록 (재료명·분류·만든 날짜·용량·개수), 분류 자동 추정 | 큐브 탭 |
| 2 | 식단 추천 — ⚡ 규칙 기반(오프라인) / ✨ Claude AI. 9개월 미만 점심·저녁, 9개월부터 아침 추가. **매끼 밥, 점심 소고기, 저녁 닭고기 또는 생선** | 식단 탭 |
| 3 | “먹었어요” 누르면 큐브 자동 차감 (되돌리기 가능), 재고 대시보드 | 홈 / 식단 탭 |
| 4 | 9개월부터 큐브 조합 레시피 추천 (기본 레시피 + AI), 만들면 재고 차감 | 레시피 탭 |
| 5 | 소비기한 = 만든 날 포함 14일. D-day 표시, 임박·초과·소진 불가 예상 알림 | 홈 / 큐브 탭 |
| 6 | 밥·소고기·닭고기(+생선) 소진 예상일과 “새로 만들기 권장일” | 홈 |

### 추천 규칙
- 소비기한이 가장 임박한 큐브부터 사용 (FEFO), 기한 지난 큐브는 절대 사용하지 않음
- 저녁 단백질은 닭고기/생선을 번갈아, 단 2일 내 기한 임박한 쪽 우선
- 같은 날 끼니 간 채소 중복 최소화
- 소진 예측은 현재 재고로 위 규칙 식단을 45일 시뮬레이션해서 계산

## 데이터
- 브라우저 localStorage에 저장. 설정 → 내보내기/가져오기로 백업·기기 이동
- Claude API 키는 해당 기기에만 저장되며 백업 파일에 포함되지 않음

### 가족 공유 (Firebase)
- 구글 로그인 후 “공유 공간”을 만들고 초대 링크로 가족이 참여 → 모든 기기 실시간 동기화
- Firestore `households/{초대코드}` 문서 하나에 앱 상태 전체를 저장 (마지막 저장 우선)
- 오프라인에서 바꾼 내용은 다시 연결되면 올라감
- 설정: `web/js/firebase-config.js`에 웹앱 설정값, Firestore 규칙은 `firestore.rules` 내용을 콘솔에 붙여넣기
- Authentication → 승인된 도메인에 `suitable8111.github.io` 추가 필요

## 개발

```bash
npm test          # 로직 단위 테스트
node scripts/serve.mjs   # http://localhost:5173 미리보기
```

```
web/            ← 배포되는 정적 사이트
  index.html
  css/style.css
  js/logic.js   ← 날짜·소비기한·식단 배정·소진 예측·레시피 (순수 함수)
  js/store.js   ← localStorage
  js/ai.js      ← Claude API (structured output)
  js/app.js     ← 화면
tests/          ← node --test
.github/workflows/deploy.yml  ← main push 시 테스트 후 GitHub Pages 배포
```

## 배포 (GitHub Pages)
1. GitHub에서 새 저장소 생성 후 push
2. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택
3. 이후 `main`에 push할 때마다 테스트 → 자동 배포
