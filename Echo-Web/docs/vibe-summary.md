# Vibe Summary & Mood Intelligence

## Overview
Echo Music Web implements upstream Echo Music parity for **Vibe Summary**, an intelligent listener personality engine that synthesizes local listening history (`db.history`) into a personalized sonic profile.

## Key Capabilities

### 1. Archetype Classification
- **Midnight Deep Diver**: Nocturnal listeners with high completion rates playing deep uninterrupted tracks.
- **Dawn Flow Pioneer**: Morning listeners welcoming the day with mindful, calm acoustic soundscapes.
- **High-Tempo Spark**: Listeners energized by high-BPM electronic, pop, and dance beats.
- **Devoted Discophile**: High artist loyalty, keeping a favorite artist on heavy rotation.
- **Sound Nomad**: Restless explorers sampling tracks across diverse styles.
- **Eclectic Harmonist**: Balanced, multifaceted listeners effortlessly traversing moods and genres.

### 2. Time-of-Day Footprint
Calculates proportional listening across:
- **Morning** (05:00 - 11:59)
- **Afternoon** (12:00 - 16:59)
- **Evening** (17:00 - 21:59)
- **Night** (22:00 - 04:59)

### 3. Visual & Shareable Experience
- Rendered in `VibeSummaryModal.tsx` accessible directly from the Recently Played page.
- Displays full breakdown: total listening minutes, track count, focus/completion rate, peak listening time, top genres bar chart, and top artists.
- One-click copy & share functionality with live toast notification.
