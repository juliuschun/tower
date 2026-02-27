---
name: naver-search-api
description: Use when searching Korean news, blogs, or web content via Naver OpenAPI. Covers news.json, blog.json endpoints, query encoding, response parsing, and Claude SDK filtering patterns for Korean ETF/finance content.
---

# Naver Search API

## Overview

Naver OpenAPI provides real-time Korean news and blog search. Requires two headers for auth. Returns JSON with `items[]` array.

## Credentials

환경변수 또는 별도 설정 파일로 관리하세요.

```
X-Naver-Client-Id:     <YOUR_NAVER_CLIENT_ID>
X-Naver-Client-Secret: <YOUR_NAVER_CLIENT_SECRET>
```

## Endpoints

| Type | URL |
|------|-----|
| News | `https://openapi.naver.com/v1/search/news.json` |
| Blog | `https://openapi.naver.com/v1/search/blog.json` |

## Parameters

| Param | Values | Default | Notes |
|-------|--------|---------|-------|
| `query` | string | required | Must be ASCII or URL-encoded Korean |
| `display` | 1–100 | 10 | Items to return |
| `start` | 1–1000 | 1 | Pagination offset |
| `sort` | `sim` / `date` | `sim` | sim=relevance, date=newest first |

⚠️ **Korean queries cause SE06 encoding error** when passed directly in shell. Always URL-encode or use Python `requests` params dict.

## curl Examples

```bash
# English/ASCII query — works directly
curl "https://openapi.naver.com/v1/search/news.json?query=ETF&display=10&sort=date" \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET"

# Blog search
curl "https://openapi.naver.com/v1/search/blog.json?query=KODEX&display=10&sort=date" \
  -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
  -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET"
```

## Python Usage (Recommended — handles Korean encoding)

```python
import requests

NAVER_HEADERS = {
    "X-Naver-Client-Id": os.environ["NAVER_CLIENT_ID"],
    "X-Naver-Client-Secret": os.environ["NAVER_CLIENT_SECRET"],
}

def search_news(query: str, display: int = 10, sort: str = "date") -> list[dict]:
    """Search Naver news. Returns items list."""
    resp = requests.get(
        "https://openapi.naver.com/v1/search/news.json",
        params={"query": query, "display": display, "sort": sort},
        headers=NAVER_HEADERS,
    )
    resp.raise_for_status()
    return resp.json().get("items", [])

def search_blog(query: str, display: int = 10) -> list[dict]:
    """Search Naver blog posts."""
    resp = requests.get(
        "https://openapi.naver.com/v1/search/blog.json",
        params={"query": query, "display": display, "sort": "date"},
        headers=NAVER_HEADERS,
    )
    resp.raise_for_status()
    return resp.json().get("items", [])
```

## Response Schema

```json
{
  "lastBuildDate": "Wed, 25 Feb 2026 02:59:28 +0900",
  "total": 544920,
  "start": 1,
  "display": 10,
  "items": [
    {
      "title": "뉴스 제목 (<b>강조</b> 태그 포함)",
      "originallink": "https://원문URL",
      "link": "https://네이버뉴스URL",
      "description": "요약 텍스트...",
      "pubDate": "Wed, 25 Feb 2026 01:42:00 +0900"
    }
  ]
}
```

⚠️ `title`과 `description`에 `<b>` HTML 태그 포함됨 — 파싱 시 제거 필요:
```python
import re
clean = re.sub(r"<[^>]+>", "", item["title"])
```

## ETF 뉴스 필터링 패턴 (Claude SDK 연동)

운용사별 쿼리로 뉴스를 수집한 뒤, 프로모션/마케팅 키워드로 분류:

```python
PROMO_KEYWORDS = ["이벤트", "프로모션", "무료", "수수료", "신규", "출시", "캠페인", "한정", "특별", "혜택"]

ETF_BRANDS = {
    "삼성자산운용": "KODEX ETF",
    "미래에셋자산운용": "TIGER ETF",
    "KB자산운용": "KBSTAR ETF",
    "한화자산운용": "ARIRANG ETF",
    "NH-Amundi": "HANARO ETF",
    "한국투자신탁운용": "ACE ETF",
    "신한자산운용": "SOL ETF",
    "키움투자자산운용": "RISE ETF",
}

def fetch_etf_news(brand_query: str, display: int = 10) -> list[dict]:
    items = search_news(brand_query, display=display, sort="date")
    results = []
    for item in items:
        clean_title = re.sub(r"<[^>]+>", "", item["title"])
        is_promo = any(kw in clean_title for kw in PROMO_KEYWORDS)
        results.append({
            "title": clean_title,
            "link": item["link"],
            "pubDate": item["pubDate"],
            "description": re.sub(r"<[^>]+>", "", item["description"]),
            "is_promo": is_promo,
        })
    return results
```

## ETF 운용사별 일괄 수집

```python
all_news = {}
for company, query in ETF_BRANDS.items():
    all_news[company] = fetch_etf_news(query, display=10)
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Korean in curl query string | Use Python requests with params dict |
| Ignoring `<b>` tags in title | Strip with `re.sub(r"<[^>]+>", "", text)` |
| Using `sort=sim` for news feed | Use `sort=date` for recency |
| Requesting >100 display items | Max is 100; paginate with `start` param |
