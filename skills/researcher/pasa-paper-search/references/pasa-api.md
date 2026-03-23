# PASA API Notes

These notes were reverse-engineered on 2026-03-23 from the public PASA frontend bundle and live HTTPS responses.

## Endpoints

Base URL:

```text
https://pasa-agent.ai/paper-agent/api/v1
```

Observed endpoints:

- `POST /single_paper_agent`
  - Start a new search.
  - Request body:

    ```json
    {
      "user_query": "generalized category discovery",
      "session_id": "1774235617151152276",
      "global_id": "1774235617163347697"
    }
    ```

- `POST /single_get_result`
  - Poll results for an existing session.
  - Request body:

    ```json
    {
      "session_id": "1774235617151152276"
    }
    ```

- `POST /read_header`
  - Returns geo/IP header information. Not needed for search.

- `POST /send_user_log`
  - Client telemetry endpoint used by the web UI. Not needed for search.

## URL Parameters Used by the Frontend

The PASA home page uses:

- `query`
- `session`

Example:

```text
https://pasa-agent.ai/home?query=generalized&session=1774235091806131914
```

This means a terminal tool can resume the session directly without automating the browser.

## Response Shape

`single_get_result` returns a JSON object like:

```json
{
  "papers": "{\"0\": {...}, \"1\": {...}}",
  "finish": true,
  "extra_data": null,
  "base_resp": {
    "status_message": "success",
    "status_code": 0,
    "extra": null
  }
}
```

Important details:

- `papers` is itself a JSON-encoded string, not a nested object.
- Each paper entry is keyed by an ordinal string (`"0"`, `"1"`, ...).
- Some entries may include `"stop": true`; the frontend ignores those.
- The frontend sorts papers by descending `score`.
- `finish` may stay `false` for a while even when partial results are already available.

## Observed Paper Fields

Common fields inside each paper object:

- `entry_id`
- `title`
- `source`
- `select_reason`
- `user_query`
- `score`
- `publish_time`
- `abstract`
- `authors`
- `json_result`
- `bib_result`

Observed `json_result` payload:

```json
{
  "link": "https://www.arxiv.org/abs/2201.02609",
  "title": "Generalized Category Discovery",
  "publish_time": "20220107",
  "authors": ["Kai Han", "Andrea Vedaldi", "Andrew Zisserman"],
  "abstract": "...",
  "score": 0.9958
}
```

`bib_result` is already a complete BibTeX entry string and is suitable for direct export.

## Behavioral Notes

- The public frontend says only English query input is supported.
- PASA currently appears to focus on arXiv papers.
- Existing sessions can be reopened later through the `home?query=...&session=...` URL or by calling `single_get_result` directly.
- The API worked without browser automation or special cookies during validation in this environment.
