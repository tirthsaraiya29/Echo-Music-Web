# Extension Matching Confidence Architecture

## Overview
Echo Music Web evaluates candidate tracks returned by external audio extensions using a multi-factor confidence scoring algorithm to prevent false-positive matches (such as playing a live or remixed version when a studio track is requested, or mismatched artists).

## Matching Pipeline & Scoring Rules

### 1. Fast-Path: ISRC Exact Match
- If the track contains an ISRC (International Standard Recording Code) and a candidate shares the exact same ISRC (case-insensitive alphanumeric), matching immediately succeeds with 100% confidence (`confidence: 1.0`, `score: 250`).

### 2. Base Token Coverage Gate
- The candidate's title tokens must cover all base tokens of the requested track title (excluding credit tokens such as `feat`, `ft`, `with`, `prod`).

### 3. Version & Qualifier Gating
- Qualifier tokens (`remix`, `live`, `acoustic`, `instrumental`, `orchestral`, `extended`, `mix`, `vip`) are strictly guarded:
  - If the user requested a specific qualifier (e.g. `Live`), the candidate must contain that qualifier.
  - If the user requested the original/studio version without qualifiers, candidates containing unwanted qualifier tokens (e.g. `(Live at Wembley)`) are rejected.

### 4. Artist Verification
- Significant artist tokens (excluding stop tokens `the`, `and`, `feat`, `prod`, `&`) must match between requested and candidate artists.

### 5. Duration Proximity
- Tracks with duration within $\pm 8$ seconds receive full duration bonus points (+15).
- Tracks within $\pm 20$ seconds receive partial bonus (+5).

### 6. Confidence Normalization
- Matching score is normalized to a confidence score between $0.0$ and $1.0$.
- Matches scoring below the minimum threshold ($< 70$ points or $< 0.45$ confidence) are rejected to protect user playback accuracy.
