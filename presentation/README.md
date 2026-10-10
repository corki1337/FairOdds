# FairOdds presentation

Eight English slides use the implemented fee model and explicitly identify the demo reserve and historical seasons. Source: `slides.html` / `slides.md`. PDF: `../output/pdf/fairodds-presentation.pdf`.

Rebuild with Node 24: `npm ci --legacy-peer-deps`, `npx playwright install chromium`, `npm run slides:pdf`. All eight PDF pages were rendered and visually checked. Browser print also works with backgrounds enabled and CSS page size.

Follow `../docs/DEMO_CHECKLIST.md` for the ≤3-minute real wallet demo. `../docs/qa/ui-walkthrough.webm` is a read-only UI verification recording; it does not show a signed bet, claim or deployed new program. Owner must capture those transactions after upgrade and environment configuration.
