/**
 * Mobile regression for the preview demo.
 * Run: node test/mobile-regression.mjs [baseUrl]
 * Measures real typewriter growth, section entrances, zoom policy, and layout.
 */
import { chromium, webkit } from 'playwright';

const base = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8765';
const VIEWPORTS = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 390, h: 660 },
  { w: 360, h: 640 }
];
const fails = [];
function check(cond, msg) {
  if (!cond) {
    fails.push(msg);
    console.error('FAIL', msg);
  } else console.log('ok  ', msg);
}

async function launch(kind) {
  if (kind === 'chromium') {
    return chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
  }
  return webkit.launch();
}

async function pageAt(browser, w, h) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2
  });
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '.breath{animation:none!important}';
      document.head.appendChild(s);
    });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  return page;
}

async function openLetter(page) {
  await page.goto(base + '/?r', { waitUntil: 'domcontentloaded' });
  await page.click('#envGo', { force: true });
  await page.waitForSelector('#R2.on #beats .actor', { timeout: 8000 });
  await page.waitForSelector('.actor[data-sec="0"].go', { timeout: 4000 });
}

function lineLen() {
  const p = document.querySelector('.sheet .ln.tw');
  const full = (p.dataset.h || '').replace(/<[^>]+>/g, '');
  return {
    len: (p.textContent || '').replace(/\u00a0/g, '').trim().length,
    done: p.dataset.done || '',
    full: full.length
  };
}

async function typewriterAndActors(page, label) {
  await openLetter(page);
  const a = await page.evaluate(() => {
    const el = document.querySelector('.actor[data-sec="0"]');
    const cs = getComputedStyle(el);
    return { x: el.getBoundingClientRect().x, anim: cs.animationName, src: el.querySelector('img').getAttribute('src') };
  });
  const l0 = await page.evaluate(lineLen);
  await page.waitForTimeout(420);
  const b = await page.evaluate(() => {
    const el = document.querySelector('.actor[data-sec="0"]');
    return { x: el.getBoundingClientRect().x, anim: getComputedStyle(el).animationName, doing: el.classList.contains('doing') };
  });
  const l1 = await page.evaluate(lineLen);
  const early = await page.evaluate(() => document.querySelector('.actor[data-sec="1"]').className);
  check(!/\bgo\b/.test(early) && !/\bdoing\b/.test(early), label + ' feelings figure stays offstage while section 1 is still typing');
  await page.screenshot({ path: '/tmp/diag-walk.png' });
  await page.waitForTimeout(700);
  const c = await page.evaluate(() => {
    const el = document.querySelector('.actor[data-sec="0"]');
    const n1 = document.querySelector('.actor[data-sec="1"]');
    return {
      doing: el.classList.contains('doing'),
      anim: getComputedStyle(el).animationName,
      pose: el.dataset.pose,
      sec1: n1.className
    };
  });
  const l2 = await page.evaluate(lineLen);
  await page.screenshot({ path: '/tmp/diag-scratch.png' });
  check(a.src.includes('him_scratch'), label + ' section 0 uses scratch asset');
  check(a.anim.includes('walkL'), label + ' section 0 walks in from the left (' + a.anim + ')');
  check(Math.abs(b.x - a.x) > 8, label + ' walk moves the figure (' + Math.round(a.x) + ' → ' + Math.round(b.x) + ')');
  check(l0.len < l1.len && l1.len < l2.len, label + ' typewriter text grows ' + [l0.len, l1.len, l2.len].join(' < '));
  check(l2.len - l0.len >= 8, label + ' text grows by at least 8 chars, got ' + (l2.len - l0.len));
  check(!l1.done && l1.len < l1.full, label + ' line is still typing at mid sample (' + l1.len + '/' + l1.full + ')');
  check(c.doing && c.anim.includes('actScratch'), label + ' scratch action after the walk (' + c.anim + ')');
  check(c.pose === 'scratch', label + ' scratch pose');

  await page.click('#sheet .ln.tw');
  await page.waitForTimeout(120);
  await page.click('#sheet .ln.tw');
  await page.waitForTimeout(200);
  const peek = await page.evaluate(() => {
    const el = document.querySelector('.actor[data-sec="1"]');
    return { on: el.dataset.on || '', src: el.querySelector('img').getAttribute('src'), from: el.dataset.from, anim: getComputedStyle(el).animationName };
  });
  check(peek.on === '1' && peek.src.includes('him_peek'), label + ' feelings figure enters on its section');
  check(peek.from === 'right' && (peek.anim.includes('walkR') || peek.anim.includes('actPeek')), label + ' peek entrance/action (' + peek.anim + ')');

  await page.click('#sheet .ln.tw');
  await page.waitForTimeout(80);
  await page.click('#sheet .ln.tw');
  await page.waitForTimeout(1100);
  const heart = await page.evaluate(() => {
    const actors = [...document.querySelectorAll('#beats .actor')];
    const el = document.querySelector('.actor[data-sec="2"]');
    return {
      n: actors.length,
      srcs: actors.map((a) => a.querySelector('img').getAttribute('src')),
      anim: getComputedStyle(el).animationName,
      doing: el.classList.contains('doing'),
      offer: !!el.querySelector('.offer')
    };
  });
  check(heart.n === 3, label + ' exactly 3 section figures, got ' + heart.n);
  check(heart.srcs.every((s) => !/him_(sorry|notes|corner|wait)/.test(s)), label + ' no extra static figures in the letter');
  check(heart.srcs[2].includes('him_heart') && heart.doing && heart.anim.includes('actGive'), label + ' heart offer action (' + heart.anim + ')');
  check(heart.offer, label + ' heart is offered with the existing heart mark');
  check(page.errors.length === 0, label + ' no page errors ' + page.errors.join(' | '));
}

async function layout(page, label) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  const home = await measure(page, '#S0');
  assertLayout(home, label + ' home', true);

  await openLetter(page);
  await page.waitForTimeout(200);
  const letter = await page.evaluate(() => {
    const sc = document.querySelector('#R2');
    return {
      overflowX: sc.scrollWidth - sc.clientWidth,
      canScroll: sc.scrollHeight > sc.clientHeight + 8,
      topReach: sc.scrollTop === 0
    };
  });
  check(letter.overflowX <= 1, label + ' letter no horizontal overflow (' + letter.overflowX + ')');
  check(letter.canScroll && letter.topReach, label + ' letter scrolls from the top');

  await page.click('#skipT');
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => {
    const sc = document.querySelector('#R2');
    const fin = document.querySelector('#final');
    let y = 0, n = fin;
    while (n && n !== sc) { y += n.offsetTop; n = n.offsetParent; }
    sc.scrollTop = y;
    const port = sc.getBoundingClientRect();
    const nodes = [...fin.querySelectorAll('.endsp, .endt, .endq, #R3')].filter((el) => el.getBoundingClientRect().height > 2);
    const top = Math.min(...nodes.map((el) => el.getBoundingClientRect().top));
    const bot = Math.max(...nodes.map((el) => el.getBoundingClientRect().bottom));
    const skip = document.querySelector('#skipT');
    return {
      mid: (top + bot) / 2,
      viewMid: port.top + port.height / 2,
      portH: port.height,
      overflowX: sc.scrollWidth - sc.clientWidth,
      text: document.querySelector('#endT').textContent,
      skipHidden: getComputedStyle(skip).display === 'none'
    };
  });
  check(end.text.includes('信写完了'), label + ' ending copy');
  check(Math.abs(end.mid - end.viewMid) < end.portH * 0.18, label + ' ending centred (off by ' + Math.round(end.mid - end.viewMid) + 'px / ' + Math.round(end.portH) + ')');
  check(end.overflowX <= 1, label + ' ending no horizontal overflow');

  await page.evaluate(() => { document.querySelector('#R2').scrollTop = 380; });
  await page.click('#R3 button');
  await page.waitForTimeout(200);
  const hubTop = await page.$eval('#hub', (el) => ({ on: el.classList.contains('on'), top: el.scrollTop }));
  check(hubTop.on && hubTop.top === 0, label + ' hub opens at scroll 0 after the letter');
  const hub = await measure(page, '#hub');
  assertLayout(hub, label + ' hub', false);
  await page.click('#hub [data-r="R2"]');
  await page.waitForTimeout(150);
  const back = await page.$eval('#R2', (el) => el.scrollTop);
  check(back === 0, label + ' returning to the letter resets scroll, got ' + back);
}

async function measure(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const port = el.getBoundingClientRect();
    const kids = [...el.children].filter((n) => {
      const s = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return s.position !== 'absolute' && r.height > 2 && s.display !== 'none';
    });
    const top = Math.min(...kids.map((n) => n.getBoundingClientRect().top));
    const bot = Math.max(...kids.map((n) => n.getBoundingClientRect().bottom));
    const fits = el.scrollHeight <= el.clientHeight + 2;
    el.scrollTop = el.scrollHeight;
    const last = kids[kids.length - 1].getBoundingClientRect();
    const lastOk = last.bottom <= port.bottom + 3 && last.top < port.bottom;
    const first = kids[0];
    el.scrollTop = 0;
    const firstTop = first.getBoundingClientRect().top - port.top;
    return {
      fits,
      overflowX: el.scrollWidth - el.clientWidth,
      mid: (top + bot) / 2,
      viewMid: port.top + port.height / 2,
      portH: port.height,
      lastOk,
      firstTop,
      fitClass: el.classList.contains('fit')
    };
  }, sel);
}

function assertLayout(m, label, expectShort) {
  check(m.overflowX <= 1, label + ' no horizontal overflow (' + m.overflowX + ')');
  if (m.fits) {
    check(Math.abs(m.mid - m.viewMid) < m.portH * 0.14, label + ' short screen centred (off ' + Math.round(m.mid - m.viewMid) + 'px)');
    if (expectShort) check(m.fitClass, label + ' uses fit centering');
  } else {
    check(m.firstTop < 80, label + ' long screen starts near the top (' + Math.round(m.firstTop) + 'px)');
    check(m.lastOk, label + ' last control can be scrolled into view');
  }
}

async function zoomAndPlay(page, label) {
  await page.goto(base + '/?r', { waitUntil: 'domcontentloaded' });
  const meta = await page.$eval('meta[name=viewport]', (el) => el.content);
  check(!/user-scalable\s*=\s*no/i.test(meta) && !/maximum-scale\s*=\s*1(\D|$)/.test(meta), label + ' pinch zoom not disabled (' + meta + ')');
  const policy = await page.evaluate(() => {
    const pick = (s) => getComputedStyle(document.querySelector(s)).touchAction;
    const fonts = [...document.querySelectorAll('input,textarea')].map((el) => parseFloat(getComputedStyle(el).fontSize));
    return { fig: pick('.fig'), env: pick('.envwrap'), pill: pick('#envGo'), minFont: Math.min(...fonts) };
  });
  check(policy.fig === 'manipulation' && policy.env === 'manipulation' && policy.pill === 'manipulation', label + ' double-tap zoom suppressed on controls');
  check(policy.minFont >= 16, label + ' inputs stay at least 16px (' + policy.minFont + ')');

  await page.click('#envGo', { force: true });
  await page.waitForSelector('#R2.on');
  await page.click('#skipT');
  await page.waitForTimeout(400);
  await page.click('#R3 button');
  await page.waitForSelector('#hub.on');
  const kneel = await page.$eval('.fig', (el) => el.getAttribute('src'));
  check(kneel.includes('set1_boy_kneel.svg'), label + ' kneeling hit figure');
  const scale0 = await page.evaluate(() => window.visualViewport.scale);
  const box = await page.locator('#stg').boundingBox();
  for (let i = 0; i < 6; i++) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 40);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    scale: window.visualViewport.scale,
    cnt: document.querySelector('#cnt').textContent,
    pleas: document.body.innerText.includes('陛下恕罪')
  }));
  check(Math.abs(after.scale - scale0) < 0.02, label + ' rapid taps do not zoom (scale ' + after.scale + ')');
  check(/已经打了 [6-9]/.test(after.cnt) || /已经打了 \d+/.test(after.cnt), label + ' hits register (' + after.cnt + ')');
  check(after.pleas, label + ' 陛下恕罪 line appears');

  await page.click('#hubGrid [data-to="fineS"]');
  await page.waitForSelector('#fineS.on');
  await page.click('#penGo');
  await page.waitForSelector('#fineOut img.out', { timeout: 4000 });
  const ticket = await page.$eval('#fineOut img.out', (el) => el.src.slice(0, 20));
  check(ticket.startsWith('data:image/jpeg'), label + ' ticket is a JPEG');

  await page.click('#fineBack');
  await page.click('#hubGrid [data-to="wheelS"]');
  await page.waitForSelector('#wheelS.on #disc .lb');
  const labels = await page.$$eval('#disc .lb', (els) => els.map((e) => e.textContent));
  check(labels.length >= 4 && labels.some((t) => t.includes('奶茶')), label + ' original wheel options');

  await page.click('#wheelS [data-r="hub"]');
  await page.click('#hub .forgive');
  await page.waitForSelector('#fgvS.on img.out', { timeout: 4000 });
  const coupon = await page.$eval('#fgvOut img.out', (el) => el.src.slice(0, 20));
  check(coupon.startsWith('data:image/jpeg'), label + ' coupon is a JPEG');

  const girl = await page.request.get(base + '/assets/chars/her_giggle.webp');
  const boy = await page.request.get(base + '/assets/chars/him_heart.webp');
  check(girl.ok() && boy.ok(), label + ' blue boy and pink girl assets still served');
}

async function sender(page, label) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.click('[data-go="W1"]');
  await page.fill('#fN', '小雨');
  await page.fill('#fS', '阿杰');
  await page.click('#W1 [data-next]');
  await page.fill('#fW', '说好七点半去接她吃饭，我迟到了两个小时，中间也没回消息');
  await page.click('#W2 [data-next]');
  await page.click('#W3 [data-next]');
  await page.fill('#p0', '那天说好七点半去接你，我晚了快两个小时。');
  await page.click('#W4 [data-next]');
  await page.fill('#p1', '你一直等不到我的消息，应该很担心。');
  await page.click('#W5 [data-next]');
  await page.fill('#p2', '以后要是会晚，我会第一时间告诉你。');
  await page.click('#W6 [data-next]');
  await page.click('#W7 [data-next]');
  await page.click('#W8 [data-next]');
  await page.waitForSelector('#T1.on #prM');
  const modes = await page.$$eval('#prM button', (els) => els.map((e) => e.textContent));
  check(modes.join('|').includes('让 TA 挑一个') && modes.join('|').includes('全都给 TA'), label + ' promise pick/all toggle');
  await page.click('#prM button[data-m="0"]');
  const hint = await page.textContent('#prH');
  check(/所有的承诺/.test(hint), label + ' all-promises hint');
  await page.click('#prM button[data-m="1"]');
  const hint2 = await page.textContent('#prH');
  check(/挑一个/.test(hint2), label + ' pick-one hint');
  const font = await page.$eval('#prL input', (el) => parseFloat(getComputedStyle(el).fontSize));
  check(font >= 16, label + ' promise input is ' + font + 'px');
}

async function runKind(kind) {
  console.log('\n== ' + kind + ' ==');
  const browser = await launch(kind);
  try {
    const main = await pageAt(browser, 390, 844);
    await typewriterAndActors(main, kind);
    await main.context().close();

    for (const v of VIEWPORTS) {
      const p = await pageAt(browser, v.w, v.h);
      await layout(p, kind + ' ' + v.w + 'x' + v.h);
      await p.context().close();
    }

    const play = await pageAt(browser, 390, 844);
    await zoomAndPlay(play, kind);
    await play.context().close();

    const s = await pageAt(browser, 375, 667);
    await sender(s, kind);
    await s.context().close();
  } finally {
    await browser.close();
  }
}

const serverNote = 'base ' + base;
console.log(serverNote);
await runKind('chromium');
await runKind('webkit');
if (fails.length) {
  console.error('\n' + fails.length + ' failure(s)');
  process.exit(1);
}
console.log('\nall mobile regression checks passed');
