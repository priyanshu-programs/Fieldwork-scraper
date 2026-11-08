import { test, expect } from "@playwright/test";
test("Collector desktop frame cadence", async ({ page }) => {
  await page.goto("/dev/collector");
  await page.getByLabel("State", { exact: true }).selectOption("fetching");
  const samples = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = 0;
        function frame(t: number) {
          if (last) out.push(t - last);
          last = t;
          if (out.length === 120) resolve(out);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
  );
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      medianFrameMs: samples[60],
      p95FrameMs: samples[114],
      samples: samples.length,
    }),
  );
  expect(samples[60]).toBeLessThan(35);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page
    .locator("svg")
    .first()
    .evaluate((e) => {
      (e as SVGElement).style.height = "700px";
    });
  await page.screenshot({
    path: ".runtime/screenshots/collector-zoom.png",
    fullPage: true,
  });
});
