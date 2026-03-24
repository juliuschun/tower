# MiroFish — Lessons Learned

Date: 2026-03-24
Project: workspace/projects/quant-finance/MiroFish

## 배경

MiroFish는 중국 오픈소스 [MiroBall](https://github.com/666ghj/MiroBall)을 포크하여
금융 시뮬레이션용으로 커스텀한 프로젝트. 문서를 업로드하면 AI 에이전트 군집이
소셜 미디어를 시뮬레이션하여 여론/트렌드를 예측한다.

## 핵심 교훈

### 1. SPA 서브패스 배포는 두 곳 설정 필수

Publishing Hub에서 SPA를 `/mirofish/` 같은 서브패스로 서빙할 때:
- **Vite**: `base: '/mirofish/'`
- **Vue Router**: `createWebHistory('/mirofish/')`
- 둘 중 하나라도 빠지면 라우팅 깨짐 → 빈 화면 또는 Tower 채팅창만 노출

### 2. Anthropic Max Subscription SDK 사용법

```python
# API key 없이 바로 사용 가능
client = anthropic.Anthropic()
response = client.messages.create(model="claude-haiku-4-20250514", ...)
```

환경변수 `ANTHROPIC_API_KEY` 불필요. Max subscription이 자동 인증 처리.

### 3. 오픈소스 포크 시 i18n 고려

중국어 원본을 그대로 포크하면 56개+ 파일에 중국어가 산재.
차후 포크 시 **i18n 레이어부터 도입**하는 것이 효율적.

### 4. 시뮬레이션 아키텍처

```
문서 업로드 → LLM 온톨로지 생성 → Zep 그래프 빌드
  → OASIS 시뮬레이션 (Twitter/Reddit)
  → Report Agent 분석 → 사용자 인터랙션
```

- Zep: 그래프 메모리 (엔티티, 관계, 커뮤니티)
- OASIS: 멀티에이전트 소셜 미디어 시뮬레이션
- Haiku 4가 기본 LLM (비용 효율)

## 파일 위치

- 프론트엔드: `MiroFish/frontend/src/`
- 백엔드: `MiroFish/backend/app/`
- 설정: `MiroFish/backend/app/config.py`
- LLM 클라이언트: `MiroFish/backend/app/utils/llm_client.py`
