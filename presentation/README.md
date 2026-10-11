# FairOdds presentation

**Pitch deck:** `pitch.html` (13 slides, English) and `FairOdds-pitch.pdf`. It is the deck for the pitch video and the Colosseum interview; the script is in [`../docs/PITCH.md`](../docs/PITCH.md). Fill the team names on slide 13, then re-export: open `pitch.html` in Edge or Chrome, Print, Save as PDF, margins none, background graphics on.

**Product deck** (below) explains the mechanics for the demo video.

Eight English slides use the implemented fee model and explicitly identify the demo reserve and historical seasons. Source: `slides.html` / `slides.md`. PDF: `../output/pdf/fairodds-presentation.pdf`.

Rebuild with Node 24: `npm ci --legacy-peer-deps`, `npx playwright install chromium`, `npm run slides:pdf`. All eight PDF pages were rendered and visually checked. Browser print also works with backgrounds enabled and CSS page size.

Follow `../docs/DEMO_CHECKLIST.md` for the ≤3-minute real wallet demo. `../docs/qa/ui-walkthrough.webm` is a read-only UI verification recording; it does not show a signed bet, claim or deployed new program. Owner must capture those transactions after upgrade and environment configuration.
