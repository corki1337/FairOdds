import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir("output/pdf", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 675 },
  });
  await page.goto(pathToFileURL(resolve("presentation/slides.html")).href);
  await page.pdf({
    path: "output/pdf/fairodds-presentation.pdf",
    printBackground: true,
    preferCSSPageSize: true,
  });
  console.log("Generated output/pdf/fairodds-presentation.pdf");
} finally {
  await browser.close();
}
