'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { landingMarkup } from './markup';

import './landing.css';

interface Props {
  /** next/font variable classes (Outfit / Plus Jakarta / Cairo) from the server page. */
  fontClass: string;
}

/**
 * Public marketing landing (ported from the clinic's standalone page).
 *
 * The bilingual markup is resolved per-locale on the server (no language
 * flash); this client wrapper only mounts it and wires the bespoke
 * interactions (scroll-reveal, animated counters, testimonials carousel,
 * mobile menu, scroll-spy, sticky-nav shadow) + the language toggle, which
 * switches the app locale route — one language system, no localStorage.
 */
export function LandingPage({ fontClass }: Props) {
  const locale = useLocale();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  const html = landingMarkup(tr, { login: `/${locale}/login`, intake: `/${locale}/intake` });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];
    const on = (
      target: EventTarget,
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler, opts);
      cleanups.push(() => target.removeEventListener(type, handler, opts));
    };

    /* ---- Scroll reveal + counters ---- */
    const revealEls = [...root.querySelectorAll<HTMLElement>('.reveal')];
    const allCounters = [...root.querySelectorAll<HTMLElement>('.count')];
    const runCount = (el: HTMLElement) => {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      const target = parseInt(el.dataset.target ?? '0', 10);
      const suffix = el.dataset.suffix ?? '';
      const dur = 1400;
      const startedAt = performance.now();
      const isYear = target > 1900;
      const tick = (now: number) => {
        const p = Math.min((now - startedAt) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(target * eased);
        el.textContent = (isYear ? val : val.toLocaleString()) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = (isYear ? target : target.toLocaleString()) + suffix;
      };
      requestAnimationFrame(tick);
    };
    const checkReveal = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      revealEls.forEach((el) => {
        if (el.classList.contains('in')) return;
        const r = el.getBoundingClientRect();
        if (r.top < vh - 30 && r.bottom > -10) {
          el.classList.add('in');
          el.querySelectorAll<HTMLElement>('.count').forEach(runCount);
          if (el.classList.contains('count')) runCount(el);
        }
      });
      allCounters.forEach((el) => {
        if (el.dataset.done) return;
        const r = el.getBoundingClientRect();
        if (r.top < vh - 10 && r.bottom > -10) runCount(el);
      });
    };
    on(window, 'scroll', checkReveal, { passive: true });
    on(window, 'resize', checkReveal);
    checkReveal();
    requestAnimationFrame(checkReveal);
    const revealTimer = window.setTimeout(checkReveal, 200);
    cleanups.push(() => window.clearTimeout(revealTimer));

    /* ---- Sticky-nav shadow + scroll spy ---- */
    const nav = root.querySelector<HTMLElement>('#nav');
    const navLinks = [...root.querySelectorAll<HTMLAnchorElement>('.nav-links a')];
    const spy = navLinks.filter(
      (a) => a.getAttribute('href')?.startsWith('#') && a.getAttribute('href') !== '#',
    );
    const sections = spy
      .map((a) => root.querySelector<HTMLElement>(a.getAttribute('href') as string))
      .filter((s): s is HTMLElement => Boolean(s));
    const onScroll = () => {
      nav?.classList.toggle('scrolled', window.scrollY > 12);
      let current = sections[0];
      sections.forEach((s) => {
        if (s.getBoundingClientRect().top <= 140) current = s;
      });
      navLinks.forEach((a) => a.classList.remove('active'));
      const active = spy.find((a) => a.getAttribute('href') === '#' + (current && current.id));
      if (active) active.classList.add('active');
      else if (window.scrollY < 200) navLinks[0]?.classList.add('active');
    };
    on(window, 'scroll', onScroll, { passive: true });
    onScroll();

    /* ---- Mobile menu ---- */
    const burger = root.querySelector<HTMLElement>('#burger');
    const menu = root.querySelector<HTMLElement>('#mobileMenu');
    const mclose = root.querySelector<HTMLElement>('#mclose');
    const openM = () => menu?.classList.add('open');
    const closeM = () => menu?.classList.remove('open');
    if (burger) on(burger, 'click', openM);
    if (mclose) on(mclose, 'click', closeM);
    menu?.querySelectorAll('a').forEach((a) => on(a, 'click', closeM));

    /* ---- Testimonials carousel ---- */
    const track = root.querySelector<HTMLElement>('#tstTrack');
    const cards = track ? [...(track.children as HTMLCollectionOf<HTMLElement>)] : [];
    const dotsWrap = root.querySelector<HTMLElement>('#tstDots');
    let index = 0;
    let maxIndex = 0;
    let autoTimer: number | undefined;
    const visibleCount = () => {
      const w = window.innerWidth;
      if (w <= 760) return 1;
      if (w <= 1080) return 2;
      return 3;
    };
    const move = () => {
      if (!cards.length || !track) return;
      const gap = 24;
      const cardW = cards[0]!.getBoundingClientRect().width + gap;
      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      track.style.transform = `translateX(${dir * index * cardW}px)`;
      if (dotsWrap) [...dotsWrap.children].forEach((d, i) => d.classList.toggle('on', i === index));
    };
    const buildDots = () => {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = '';
      for (let i = 0; i <= maxIndex; i++) {
        const b = document.createElement('button');
        if (i === index) b.classList.add('on');
        b.addEventListener('click', () => {
          index = i;
          move();
          resetAuto();
        });
        dotsWrap.appendChild(b);
      }
    };
    const layout = () => {
      if (!track) return;
      maxIndex = Math.max(0, cards.length - visibleCount());
      if (index > maxIndex) index = maxIndex;
      buildDots();
      move();
    };
    const next = () => {
      index = index >= maxIndex ? 0 : index + 1;
      move();
    };
    const prev = () => {
      index = index <= 0 ? maxIndex : index - 1;
      move();
    };
    function resetAuto() {
      if (autoTimer) window.clearInterval(autoTimer);
      autoTimer = window.setInterval(next, 5200);
    }
    const nextBtn = root.querySelector<HTMLElement>('#tstNext');
    const prevBtn = root.querySelector<HTMLElement>('#tstPrev');
    if (nextBtn)
      on(nextBtn, 'click', () => {
        next();
        resetAuto();
      });
    if (prevBtn)
      on(prevBtn, 'click', () => {
        prev();
        resetAuto();
      });
    on(window, 'resize', layout);
    if (track) {
      layout();
      resetAuto();
    }
    cleanups.push(() => {
      if (autoTimer) window.clearInterval(autoTimer);
    });

    /* ---- Language toggle → switch the app locale route ---- */
    const langBtn = root.querySelector<HTMLElement>('#langBtn');
    if (langBtn)
      on(langBtn, 'click', () => {
        const other = isAr ? 'en' : 'ar';
        document.cookie = `NEXT_LOCALE=${other}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
        router.push(`/${other}`);
      });

    return () => cleanups.forEach((fn) => fn());
  }, [isAr, router]);

  return (
    <div
      ref={rootRef}
      className={`theone-landing ${fontClass}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
