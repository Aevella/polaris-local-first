import { chromium, webkit } from 'playwright';
import { writeFile } from 'node:fs/promises';

// Run against an isolated local Vite server. No customer data or model requests.
// POLARIS_QA_BROWSER=webkit npx tsx tools/timeline-scroll-stress-qa.ts
// POLARIS_QA_SCENARIO=reading uses short scroll gestures with reading pauses.
// POLARIS_QA_SCENARIO=touch uses Chromium CDP sustained presses and slow drags.
// DOM visibility does not prove compositor paint. Set POLARIS_QA_VIDEO to a
// temporary output directory and inspect the recording for blank painted frames.
const touch = process.env.POLARIS_QA_SCENARIO === 'touch';
const engine = process.env.POLARIS_QA_BROWSER ?? (touch ? 'chromium' : 'webkit');
const reading = process.env.POLARIS_QA_SCENARIO === 'reading';
const wheelDelta = Number(process.env.POLARIS_QA_WHEEL_DELTA ?? (reading ? 100 : 3000));
const requestedDistance = wheelDelta * 100;
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engine === 'webkit' ? {} : { channel: 'chrome' })
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, ...(process.env.POLARIS_QA_VIDEO ? {recordVideo: { dir: process.env.POLARIS_QA_VIDEO, size: {width:390,height:844} }} : {}) });
  // tsx preserves names inside serialized page callbacks via this helper.
  await page.addInitScript('window.__name = (value) => value;');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.env.POLARIS_QA_URL ?? 'http://127.0.0.1:4198'}/?debugQa=1`);
  await page.waitForSelector('.app-shell');
  await page.waitForTimeout(1800);
  await page.evaluate(async () => {
    const spacePath = '/src/stores/spaceStore.ts';
    const chatPath = '/src/stores/chatStore.ts';
    const { useSpaceStore } = await import(spacePath) as typeof import('../src/stores/spaceStore');
    const { useChatStore } = await import(chatPath) as typeof import('../src/stores/chatStore');
    useSpaceStore.getState().setFrontstageCollaboratorId('pharos');
    useSpaceStore.getState().setWorld('chat');
    const state = useChatStore.getState();
    const id = state.createConversation('pharos');
    const writable = await state.ensureConversationWritable(id);
    if (!writable) throw new Error('QA conversation did not become writable');
    state.replaceConversationMessages(writable, Array.from({ length: 1000 }, (_, index) => ({
      id: `stress-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `Message ${index}\n\n${'长对话阅读测试，这是一段完整的文字，用于验证滚动位置稳定。'.repeat(index % 7 ? 3 : 150)}`,
      timestamp: Date.now() + index
    })));
    state.setActiveConversation(id);
  });
  await page.waitForSelector('.chat-flow [data-message-id]');
  await page.waitForTimeout(1200);
  if (process.env.POLARIS_QA_STATIC === '1') {
    await page.goto('about:blank');
    await page.setContent('<style>body{margin:0}.chat-flow{height:700px;overflow:auto;display:flex;flex-direction:column;gap:16px;font:16px/1.6 sans-serif}.chat-flow>div{flex:none;white-space:pre-wrap}</style><div class="chat-flow"></div>');
    await page.locator('.chat-flow').evaluate((flow) => {
      for (let index = 0; index < 1000; index += 1) {
        const row = document.createElement('div');
        row.dataset.messageId = `stress-${index}`;
        row.textContent = `Message ${index}\n\n${'长对话阅读测试，这是一段完整的文字，用于验证滚动位置稳定。'.repeat(index % 7 ? 3 : 150)}`;
        flow.append(row);
      }
      flow.scrollTop = flow.scrollHeight;
    });
    await page.waitForTimeout(300);
  }
  const samples: Array<{ time: number; top: number; displacement: number | null; visible: boolean; firstIndex: number | null; firstOffset: number | null; commonId: string | null; commonOffset: number | null }> = [];
  await page.exposeFunction('recordTimelineFrame', (sample: typeof samples[number]) => samples.push(sample));
  await page.locator('.chat-flow').evaluate((flow) => {
    let previous = new Map<string, number>();
    const heights: Record<string, number> = {};
    (window as unknown as { timelineStressHeights: typeof heights }).timelineStressHeights = heights;
    const record = (window as unknown as { recordTimelineFrame: (sample: unknown) => Promise<void> }).recordTimelineFrame;
    const tick = () => {
      const top = flow.getBoundingClientRect().top;
      const rows = Array.from(flow.querySelectorAll<HTMLElement>('[data-message-id]'));
      const geometry = rows.map((row) => {
        const rect = row.getBoundingClientRect();
        if (heights[row.dataset.messageId!] === undefined) heights[row.dataset.messageId!] = (row.closest('.chat-flow-window-row') ?? row).getBoundingClientRect().height;
        return { id: row.dataset.messageId!, top: rect.top - top, bottom: rect.bottom - top };
      });
      const offsets = new Map(geometry.map((row) => [row.id, row.top]));
      const common = geometry.find((row) => previous.has(row.id) && row.bottom > 0);
      const first = geometry.find((row) => row.bottom > 0 && row.top < flow.clientHeight);
      void record({
        commonId: common?.id ?? null,
        commonOffset: common?.top ?? null,
        time: performance.now(),
        firstIndex: first ? Number(first.id.split('-')[1]) : null,
        firstOffset: first?.top ?? null,
        top: flow.scrollTop,
        displacement: common ? common.top - previous.get(common.id)! : null,
        visible: Boolean(first)
      });
      previous = offsets;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = (await page.locator('.chat-flow').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    for (let gesture = 0; gesture < 12; gesture += 1) {
      const y = box.y + 80;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(450);
      for (let step = 1; step <= 20; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 22 }] });
        await page.waitForTimeout(25);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(350);
    }
    await cdp.detach();
  } else {
  for (let step = 0; step < 100; step += 1) {
    await page.mouse.wheel(0, -wheelDelta);
    await page.waitForTimeout(reading ? 32 : 16);
    if (reading && step % 10 === 9) await page.waitForTimeout(700);
  }
  }
  await page.waitForTimeout(600);
  const measured = await page.locator('.chat-flow').evaluate((flow) => ({
    heights: (window as unknown as { timelineStressHeights: Record<string, number> }).timelineStressHeights,
    gap: parseFloat(getComputedStyle(flow).rowGap) || 0
  }));
  const initial = samples[0];
  const final = samples[samples.length - 1]!;
  let distance: number | null = final.firstOffset! - initial.firstOffset!;
  for (let index = final.firstIndex!; index < initial.firstIndex!; index += 1) {
    const height = measured.heights[`stress-${index}`];
    if (height === undefined) { distance = null; break; }
    distance += height + measured.gap;
  }
  const reversals = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    if (!previous || sample.firstIndex === null || previous.firstIndex === null) return false;
    return sample.firstIndex > previous.firstIndex || (sample.firstIndex === previous.firstIndex
      && sample.firstOffset! < previous.firstOffset! - 5);
  });
  if (process.env.POLARIS_QA_TRACE) await writeFile(process.env.POLARIS_QA_TRACE, JSON.stringify(samples));
  const blankFrames = samples.filter((sample) => !sample.visible).length;
  console.log(JSON.stringify({ engine, scenario: touch ? 'touch' : reading ? 'reading' : 'stress', errors, distance, requestedDistance: touch ? null : requestedDistance, reversals, offscreenCandidates: samples.filter((sample) => sample.displacement !== null && sample.displacement < -5), domBlankFrames: blankFrames, renderedFramesVerified: false, frames: samples.length }, null, 2));
  if (errors.length || reversals.length || blankFrames || (touch ? distance === null || distance <= 0 : distance === null || Math.abs(distance - requestedDistance) > 1)) process.exitCode = 1;
} finally {
  await browser.close();
}
