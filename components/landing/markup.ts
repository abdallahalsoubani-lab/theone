/**
 * Landing-page markup (Prompt: public landing).
 *
 * Ported from the standalone "The One Home.html" the clinic supplied. The
 * bespoke, SVG-heavy marketing design is kept verbatim as an HTML string so it
 * renders pixel-identical; the only changes are integration ones:
 *   - bilingual copy resolved per-locale via `t(en, ar)` AT RENDER (server-side,
 *     so there's no English→Arabic flash on /ar — one language system, the app
 *     locale; the old data-en/data-ar + localStorage toggle is gone),
 *   - asset paths point at /landing/*, photos are real <img> (the design-time
 *     <image-slot> tooling is dropped),
 *   - "Login" → the real /login, every "Book Appointment/Consultation" → /intake,
 *   - dead placeholder links neutralised to in-page anchors.
 *
 * Interactivity (reveal, counters, carousel, mobile menu, scroll-spy) is wired
 * by LandingInteractive.tsx against this markup.
 */

type Tr = (en: string, ar: string) => string;

interface Hrefs {
  login: string;
  intake: string;
}

const ARROW =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ARROW_SM =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export function landingMarkup(t: Tr, hrefs: Hrefs): string {
  return `
<header class="nav" id="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="#top" aria-label="The One Physical Therapy Center">
      <span class="mark"><img src="/landing/logo.jpg" alt="The One logo"></span>
      <span class="name">
        <b>THE <span>ONE</span></b>
        <small>${t('Physical Therapy Center', 'مركز العلاج الطبيعي')}</small>
      </span>
    </a>
    <nav class="nav-links">
      <a href="#top" class="active">${t('Home', 'الرئيسية')}</a>
      <a href="#about">${t('About', 'من نحن')}</a>
      <a href="#services">${t('Services', 'خدماتنا')}</a>
      <a href="#testimonials">${t('Success Stories', 'قصص النجاح')}</a>
      <a href="#book">${t('Contact', 'تواصل معنا')}</a>
    </nav>
    <div class="nav-tools">
      <button class="lang" id="langBtn" aria-label="Switch language">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>
        <span>${t('العربية', 'English')}</span>
      </button>
      <a href="${hrefs.login}" class="nav-login">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
        <span>${t('Login', 'تسجيل الدخول')}</span>
      </a>
      <a href="${hrefs.intake}" class="btn btn-primary nav-cta">
        <span class="txt">${t('Book Appointment', 'احجز موعدك')}</span>
        <span class="ico">${ARROW}</span>
      </a>
      <button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>

<div class="mobile-menu" id="mobileMenu">
  <button class="mclose" id="mclose">✕</button>
  <a href="#top">${t('Home', 'الرئيسية')}</a>
  <a href="#about">${t('About', 'من نحن')}</a>
  <a href="#services">${t('Services', 'خدماتنا')}</a>
  <a href="#testimonials">${t('Success Stories', 'قصص النجاح')}</a>
  <a href="#book">${t('Contact', 'تواصل معنا')}</a>
  <a href="${hrefs.login}">${t('Login', 'تسجيل الدخول')}</a>
  <a href="${hrefs.intake}" class="btn btn-primary">${t('Book Appointment', 'احجز موعدك')}</a>
</div>

<div id="top">

<section class="section hero" style="padding-bottom:0">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow reveal"><span class="dot"></span><span>${t('Care · Compassion · Results', 'رعاية · تعاطف · نتائج')}</span></span>
      <h1 class="reveal" data-d="1">${t("Care in<br>Every <span class='grad'>Step</span>", "رعاية في<br>كل <span class='grad'>خطوة</span>")}</h1>
      <p class="lead reveal" data-d="2">${t('Personalized physical therapy for all ages. We help you move better, feel stronger, and live your life with confidence — in a place that feels like home.', 'علاج طبيعي مخصّص لجميع الأعمار. نساعدك على الحركة بشكل أفضل، والشعور بقوّة أكبر، وعيش حياتك بثقة — في مكان يشبه البيت.')}</p>
      <div class="hero-actions reveal" data-d="3">
        <a href="${hrefs.intake}" class="btn btn-primary"><span>${t('Book Appointment', 'احجز موعدك')}</span><span class="ico">${ARROW}</span></a>
        <a href="#about" class="btn btn-ghost"><span>${t('Learn More', 'اعرف المزيد')}</span><span class="ico">${ARROW}</span></a>
      </div>
      <div class="trust reveal" data-d="4">
        <div class="avatars">
          <span style="background:linear-gradient(135deg,#e8b78a,#cf9466)"></span>
          <span style="background:linear-gradient(135deg,#7fb3e0,#4f7fb8)"></span>
          <span style="background:linear-gradient(135deg,#d9a06b,#b87a45)"></span>
          <span style="background:linear-gradient(135deg,#7fd0d8,#46a9b8)"></span>
        </div>
        <div>
          <b>${t('Trusted by 1,000+ Patients', 'موثوق من أكثر من 1,000 مريض')}</b>
          <div class="stars">★★★★★ <i>${t('5.0 from 250+ reviews', '5.0 من أكثر من 250 تقييم')}</i></div>
        </div>
      </div>
    </div>

    <div class="hero-visual reveal" data-d="2">
      <div class="blob b1"></div>
      <div class="blob b2"></div>
      <div class="spine"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <img class="hero-photo" src="/landing/hero.webp" alt="${t('A therapist working with a patient at The One', 'اختصاصي علاج طبيعي مع مريض في «ذا ون»')}">
      <div class="hero-cards">
        <div class="hero-card one">
          <span class="ic" style="background:linear-gradient(135deg,#e2557a,#c23a5e)"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.3 5c2 0 3.4 1.2 4.2 2.4C10.3 6.2 11.7 5 13.7 5 17 5 18.6 8.4 17 11.7 14.5 16.4 12 21 12 21z"/></svg></span>
          <div><b>${t('1,000+', '+1,000')}</b><small>${t('Happy patients', 'مريض سعيد')}</small></div>
        </div>
        <div class="hero-card two">
          <span class="ic" style="background:linear-gradient(135deg,#f5c518,#e0a800)"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 6 21.4l1.4-6.8L2.3 9.9l6.9-.8z"/></svg></span>
          <div><b>5.0 ★</b><small>${t('250+ reviews', 'أكثر من 250 تقييم')}</small></div>
        </div>
      </div>
    </div>
  </div>
  <svg class="wave" viewBox="0 0 1440 130" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0,70 C240,120 480,20 720,55 C960,90 1200,120 1440,60 L1440,130 L0,130 Z" fill="#eef4ff"></path>
    <path d="M0,90 C260,40 520,120 780,80 C1040,45 1240,90 1440,75 L1440,130 L0,130 Z" fill="#eaf7f0" opacity="0.7"></path>
  </svg>
</section>

<section class="section" style="background:#eef4ff;padding-top:clamp(40px,5vw,80px)">
  <div class="wrap">
    <div class="section-head">
      <h2 class="h2 reveal">${t("Committed to <span class='accent'>Excellence</span>", "ملتزمون <span class='accent'>بالتميّز</span>")}</h2>
      <p class="lead reveal" data-d="1">${t('From personalized care plans to the latest evidence-based techniques, we strive to provide every patient with the highest standard of treatment. Our team continually pursues professional growth and innovation to ensure every visit moves you closer to lasting strength, confidence, and well-being.', 'من خطط الرعاية المخصّصة إلى أحدث التقنيات المبنية على الأدلة، نسعى لتقديم أعلى مستوى من العلاج لكل مريض. يواصل فريقنا تطوّره المهني والابتكار لضمان أن تقرّبك كل زيارة من قوة وثقة وعافية دائمة.')}</p>
    </div>

    <div class="reviews">
      <div class="review-list">
        <article class="review reveal">
          <div class="stars">★★★★★</div>
          <p>${t('As an employee at the center, I witness heartwarming stories every day ❤️ Children are making remarkable progress through physical therapy, occupational therapy, and speech sessions. The difference our team makes is real and lasting.', 'بصفتي موظفة في المركز، أشهد قصصاً مؤثّرة كل يوم ❤️ يحقّق الأطفال تقدّماً ملحوظاً من خلال العلاج الطبيعي والوظيفي وجلسات النطق. الفرق الذي يصنعه فريقنا حقيقي ودائم.')}</p>
          <div class="by">— <span>${t('Alaa Alshmilan', 'آلاء الشميلان')}</span></div>
        </article>
        <article class="review reveal" data-d="1">
          <div class="stars">★★★★★</div>
          <p>${t('Thank you for your cooperation and excellence. May God bless you, bring goodness through your hands, and grant you more of His grace. I wish you continued success, growth, and many future achievements.', 'شكراً لتعاونكم وتميّزكم. بارك الله فيكم، وجعل الخير على أيديكم، وزادكم من فضله. أتمنى لكم دوام النجاح والنمو والمزيد من الإنجازات.')}</p>
          <div class="by">— <span>${t('Mhamad Bairoti', 'محمد بيروتي')}</span></div>
        </article>
        <article class="review reveal" data-d="2">
          <div class="stars">★★★★★</div>
          <p>${t("An absolutely amazing center. My son benefited a lot after many previous attempts that didn't help — we only saw real progress with Dr. Sahar, she's wonderful! All the staff are amazing, thank you so much for your efforts.", 'مركز رائع حقاً. استفاد ابني كثيراً بعد محاولات سابقة لم تُجدِ — لم نرَ تقدّماً حقيقياً إلا مع د. سحر، إنها رائعة! كل الطاقم مذهل، شكراً جزيلاً على جهودكم.')}</p>
          <div class="by">— <span>${t('Um Taim', 'أم تيم')}</span></div>
        </article>
        <div class="reviews-foot">
          <a href="#testimonials" class="btn btn-outline"><span>${t('View all feedback', 'عرض كل الآراء')}</span><span class="ico" style="background:transparent">${ARROW_SM}</span></a>
        </div>
      </div>
      <img class="team-photo reveal" data-d="1" src="/landing/team.webp" alt="${t('The One care team', 'فريق الرعاية في «ذا ون»')}">
    </div>
  </div>
</section>

<section class="section" id="about">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow reveal"><span class="dot"></span><span>${t('About Us · Our Story', 'من نحن · قصتنا')}</span></span>
      <h2 class="h2 reveal" data-d="1" style="margin-top:18px">${t("About <span class='accent'>'The One'</span>", "عن <span class='accent'>«ذا ون»</span>")}</h2>
      <p class="lead reveal" data-d="2">${t('We believe Physical Therapy is essential to health, mobility, and quality of life — restoring movement and improving lives, one patient at a time.', 'نؤمن أن العلاج الطبيعي أساسي للصحة والحركة وجودة الحياة — نستعيد الحركة ونحسّن الحياة، مريضاً تلو الآخر.')}</p>
    </div>

    <div class="about-grid">
      <div class="about-copy reveal">
        <p class="intro">${t('We believe Physical Therapy is essential to health, mobility, and quality of life. Through a holistic approach that combines techniques with compassionate care, we restore movement and improve function.', 'نؤمن أن العلاج الطبيعي أساسي للصحة والحركة وجودة الحياة. من خلال نهج شامل يجمع بين التقنيات والرعاية الرحيمة، نستعيد الحركة ونحسّن الوظيفة.')}</p>
        <div class="mission">
          <h3>${t('Our Mission', 'مهمتنا')}</h3>
          <p>${t('Our mission is to give hope and relieve pain through expert care for children and adults, helping them overcome motor and physical challenges.', 'مهمتنا أن نمنح الأمل ونخفّف الألم من خلال رعاية متخصصة للأطفال والبالغين، لمساعدتهم على تجاوز التحديات الحركية والجسدية.')}</p>
        </div>
        <a href="${hrefs.intake}" class="btn btn-green" style="width:100%;justify-content:center"><span>${t('Book Consultation', 'احجز استشارة')}</span><span class="ico">${ARROW}</span></a>
      </div>

      <div class="about-side">
        <div class="stat-row">
          <div class="stat s1 reveal"><b class="count" data-target="2021" data-suffix="">2021</b><small>${t('Founded', 'تأسّست')}</small></div>
          <div class="stat s2 reveal" data-d="1"><b class="count" data-target="17" data-suffix="">17</b><small>${t('Years Exp', 'سنوات خبرة')}</small></div>
          <div class="stat s3 reveal" data-d="2"><b class="count" data-target="500" data-suffix="+">500+</b><small>${t('Success', 'حالة نجاح')}</small></div>
        </div>
        <div class="achieve reveal" data-d="1">
          <div class="achieve-head">
            <div class="t">
              <span class="badge"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 22l5-3 5 3-1.5-9.5"/></svg></span>
              <h3>${t('Achievements', 'الإنجازات')}</h3>
            </div>
            <a href="#about" class="link-arrow"><span>${t('View all', 'عرض الكل')}</span>${ARROW_SM}</a>
          </div>
          <ul>
            <li><span class="ck"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span>${t('Certified in Dynamic Movement Intervention (DMI)', 'معتمدون في تدخّل الحركة الديناميكي (DMI)')}</span></li>
            <li><span class="ck"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span>${t('Certified in Dry Needling Therapy (Beginner &amp; Advanced)', 'معتمدون في علاج الإبر الجافة (مبتدئ ومتقدّم)')}</span></li>
            <li><span class="ck"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span>${t('Certified in ERGON IASTM Technique', 'معتمدون في تقنية ERGON IASTM')}</span></li>
            <li><span class="ck"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span>${t('Certified in Sensory Integration Therapy', 'معتمدون في علاج التكامل الحسي')}</span></li>
            <li><span class="ck"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span><span>${t('Certification in Kinesio Taping', 'شهادة في تقنية كينيسيو تيب')}</span></li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section why">
  <div class="wrap">
    <div class="section-head">
      <h2 class="h2 reveal">${t("Why Choose <span class='accent'>The One?</span>", "لماذا تختار <span class='accent'>«ذا ون»؟</span>")}</h2>
      <p class="lead reveal" data-d="1">${t('Expert care, evidence-based practices, and a compassionate approach — so you can focus on what matters most: getting better.', 'رعاية متخصّصة، وممارسات قائمة على الأدلة، ونهج رحيم — لتركّز على ما يهمّ فعلاً: تحسّنك.')}</p>
    </div>
    <div class="feature-row">
      <article class="feature reveal">
        <span class="ic" style="background:#e7f0fc;color:var(--blue)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
        <div class="num count" data-target="10" data-suffix="+">10+</div>
        <h3>${t('Trusted Years', 'سنوات من الثقة')}</h3>
        <p>${t('A decade of helping patients of all ages move and live better.', 'عقد من مساعدة المرضى من جميع الأعمار على الحركة والحياة بشكل أفضل.')}</p>
      </article>
      <article class="feature reveal" data-d="1">
        <span class="ic" style="background:#eaf7f0;color:var(--green)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></span>
        <div class="num count" data-target="15" data-suffix="+">15+</div>
        <h3>${t('Specializations', 'تخصّصات')}</h3>
        <p>${t("From pediatrics to women's health and complex rehabilitation.", 'من طب الأطفال إلى صحة المرأة والتأهيل المعقّد.')}</p>
      </article>
      <article class="feature reveal" data-d="2">
        <span class="ic" style="background:#e7f0fc;color:var(--blue)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg></span>
        <div class="num count" data-target="100" data-suffix="%">100%</div>
        <h3>${t('Certified Professionals', 'اختصاصيون معتمدون')}</h3>
        <p>${t('Accredited therapists committed to safe, effective, and personalized care.', 'اختصاصيون معتمدون ملتزمون برعاية آمنة وفعّالة ومخصّصة.')}</p>
      </article>
    </div>
  </div>
</section>

<section class="section services" id="services">
  <div class="wrap">
    <div class="svc-head">
      <div>
        <h2 class="h2 reveal">${t("Our <span class='accent'>Services</span>", "<span class='accent'>خدماتنا</span>")}</h2>
        <p class="lead reveal" data-d="1">${t('Tailored therapy programs for every stage of life.', 'برامج علاجية مصمّمة لكل مرحلة من العمر.')}</p>
      </div>
      <a href="#services" class="link-arrow reveal" data-d="1"><span>${t('View All Services', 'عرض كل الخدمات')}</span>${ARROW_SM}</a>
    </div>
    <div class="svc-grid">
      <article class="svc-card reveal">
        <div class="svc-media"><img src="/landing/svc-1.webp" alt="${t('Hydrotherapy', 'العلاج المائي')}"></div>
        <div class="svc-body">
          <h3><span class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 16c2 0 2-1.5 4-1.5S10 16 12 16s2-1.5 4-1.5S20 16 22 16M2 20c2 0 2-1.5 4-1.5S10 20 12 20s2-1.5 4-1.5S20 20 22 20M5 12V5a3 3 0 0 1 6 0M9 12V5"/></svg></span><span>${t('Hydrotherapy', 'العلاج المائي')}</span></h3>
          <p>${t('At The One Center, our pediatric hydrotherapy program is specially designed for infants and young children to build strength and confidence in the water…', 'في مركز «ذا ون»، صُمّم برنامج العلاج المائي للأطفال خصيصاً للرضّع والأطفال الصغار لبناء القوة والثقة في الماء…')}</p>
          <a href="#book" class="link-arrow"><span>${t('Learn More', 'اعرف المزيد')}</span>${ARROW_SM}</a>
        </div>
      </article>
      <article class="svc-card reveal" data-d="1">
        <div class="svc-media"><img src="/landing/svc-2.webp" alt="${t('Combined Pediatric OT & PT Sessions', 'جلسات مدمجة للأطفال (وظيفي وطبيعي)')}"></div>
        <div class="svc-body">
          <h3><span class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="3"/><path d="M12 9v7M8 22l4-6 4 6M6 13h12"/></svg></span><span>${t('Combined Pediatric OT &amp; PT Sessions', 'جلسات مدمجة للأطفال (وظيفي وطبيعي)')}</span></h3>
          <p>${t("At The One Center, our combined occupational therapy (OT) and physical therapy (PT) sessions are designed to support every aspect of your child's growth…", 'في مركز «ذا ون»، صُمّمت جلساتنا المدمجة للعلاج الوظيفي والطبيعي لدعم كل جانب من جوانب نمو طفلك…')}</p>
          <a href="#book" class="link-arrow"><span>${t('Learn More', 'اعرف المزيد')}</span>${ARROW_SM}</a>
        </div>
      </article>
      <article class="svc-card reveal" data-d="2">
        <div class="svc-media"><img src="/landing/svc-3.webp" alt="${t('Pediatric Group Therapy Sessions', 'جلسات علاج جماعي للأطفال')}"></div>
        <div class="svc-body">
          <h3><span class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 21v-1a6 6 0 0 1 12 0v1M15 21v-.5a4.5 4.5 0 0 1 6-4"/></svg></span><span>${t('Pediatric Group Therapy Sessions', 'جلسات علاج جماعي للأطفال')}</span></h3>
          <p>${t('At The One Center, our pediatric group therapy sessions are designed to help children develop social, motor, and communication skills together…', 'في مركز «ذا ون»، صُمّمت جلسات العلاج الجماعي للأطفال لمساعدتهم على تطوير المهارات الاجتماعية والحركية والتواصلية معاً…')}</p>
          <a href="#book" class="link-arrow"><span>${t('Learn More', 'اعرف المزيد')}</span>${ARROW_SM}</a>
        </div>
      </article>
    </div>
  </div>
</section>

<section class="section tst" id="testimonials">
  <div class="wrap tst-grid">
    <div class="tst-intro reveal">
      <h2>${t('&ldquo;Feels like home&rdquo;', '«يشبه البيت»')}</h2>
      <p>${t("It's more than therapy — it's a supportive environment where you feel cared for, encouraged, and never alone.", 'إنه أكثر من مجرد علاج — إنها بيئة داعمة تشعر فيها بالرعاية والتشجيع ولا تكون وحيداً أبداً.')}</p>
    </div>
    <div class="tst-view reveal" data-d="1">
      <div class="tst-track" id="tstTrack">
        <article class="tst-card">
          <span class="q"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 7H6a3 3 0 0 0-3 3v6h6v-6H6c0-1.1.9-2 2-2h2zM21 7h-4a3 3 0 0 0-3 3v6h6v-6h-3c0-1.1.9-2 2-2h2z"/></svg></span>
          <p>${t('As an employee at the center, I witness heartwarming stories every day ❤️ Children are making remarkable progress…', 'بصفتي موظفة في المركز، أشهد قصصاً مؤثّرة كل يوم ❤️ يحقّق الأطفال تقدّماً ملحوظاً…')}</p>
          <div class="who"><span class="ava" style="background:linear-gradient(135deg,#4f7fb8,#2b5da8)">A</span><div><b>${t('Alaa Alshmilan', 'آلاء الشميلان')}</b><div class="stars" style="color:var(--yellow);font-size:.85rem">★★★★★</div></div></div>
        </article>
        <article class="tst-card">
          <span class="q"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 7H6a3 3 0 0 0-3 3v6h6v-6H6c0-1.1.9-2 2-2h2zM21 7h-4a3 3 0 0 0-3 3v6h6v-6h-3c0-1.1.9-2 2-2h2z"/></svg></span>
          <p>${t('Thank you for your cooperation and excellence. May God bless you, bring goodness through your hands…', 'شكراً لتعاونكم وتميّزكم. بارك الله فيكم وجعل الخير على أيديكم…')}</p>
          <div class="who"><span class="ava" style="background:linear-gradient(135deg,#46a9b8,#34b4d8)">M</span><div><b>${t('Mhamad Bairoti', 'محمد بيروتي')}</b><div class="stars" style="color:var(--yellow);font-size:.85rem">★★★★★</div></div></div>
        </article>
        <article class="tst-card">
          <span class="q"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 7H6a3 3 0 0 0-3 3v6h6v-6H6c0-1.1.9-2 2-2h2zM21 7h-4a3 3 0 0 0-3 3v6h6v-6h-3c0-1.1.9-2 2-2h2z"/></svg></span>
          <p>${t("An absolutely amazing center. My son benefited a lot after many previous attempts that didn't help…", 'مركز رائع حقاً. استفاد ابني كثيراً بعد محاولات سابقة لم تُجدِ…')}</p>
          <div class="who"><span class="ava" style="background:linear-gradient(135deg,#5aa66a,#2f9e54)">U</span><div><b>${t('Um Taim', 'أم تيم')}</b><div class="stars" style="color:var(--yellow);font-size:.85rem">★★★★★</div></div></div>
        </article>
        <article class="tst-card">
          <span class="q"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 7H6a3 3 0 0 0-3 3v6h6v-6H6c0-1.1.9-2 2-2h2zM21 7h-4a3 3 0 0 0-3 3v6h6v-6h-3c0-1.1.9-2 2-2h2z"/></svg></span>
          <p>${t("The team is patient, professional, and truly caring. We finally found a place that understands our child's needs.", 'الفريق صبور ومحترف ويهتم حقاً. وجدنا أخيراً مكاناً يفهم احتياجات طفلنا.')}</p>
          <div class="who"><span class="ava" style="background:linear-gradient(135deg,#c98a52,#a86a35)">R</span><div><b>${t('Rania K.', 'رانية ك.')}</b><div class="stars" style="color:var(--yellow);font-size:.85rem">★★★★★</div></div></div>
        </article>
      </div>
      <div class="tst-foot">
        <div class="dots" id="tstDots"></div>
        <div class="arrows">
          <button id="tstPrev" aria-label="Previous"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
          <button id="tstNext" aria-label="Next"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="book" style="background:linear-gradient(180deg,#fff,#eef4ff)">
  <div class="wrap">
    <div class="book-card reveal">
      <div class="book-left">
        <span class="eyebrow">${t('Ready to start?', 'جاهز للبدء؟')}</span>
        <h2>${t('Book Your Appointment', 'احجز موعدك')}</h2>
        <p>${t("Your first step toward a better, stronger you. We're here to help you on your journey to recovery.", 'خطوتك الأولى نحو نسخة أفضل وأقوى منك. نحن هنا لمساعدتك في رحلة تعافيك.')}</p>
        <div class="book-perks">
          <div class="perk"><span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg></span><span>${t('Quick &amp; Easy Online Booking', 'حجز سريع وسهل عبر الإنترنت')}</span></div>
          <div class="perk"><span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><span>${t('Flexible Appointment Times', 'مواعيد مرنة')}</span></div>
          <div class="perk"><span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 21v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.5M19 21v-1a5 5 0 0 0-3-4.6"/></svg></span><span>${t('Dedicated Care Team', 'فريق رعاية مخصّص')}</span></div>
        </div>
        <svg class="wave2" viewBox="0 0 600 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0,38 C150,8 300,60 450,38 C520,28 560,40 600,34 L600,70 L0,70 Z" fill="rgba(255,255,255,.16)"/><path d="M0,50 C160,28 320,66 480,48 C540,42 580,52 600,48 L600,70 L0,70 Z" fill="#2f9e54" opacity=".55"/></svg>
      </div>
      <div class="book-right">
        <h3>${t("Let's Get You Started", 'لنبدأ رحلتك')}</h3>
        <p class="sub">${t("Fill in our quick intake form and we'll contact you to confirm your appointment.", 'املأ استمارة الاستقبال السريعة وسنتواصل معك لتأكيد موعدك.')}</p>
        <div class="book-cta-wrap">
          <a href="${hrefs.intake}" class="btn btn-green field full" style="justify-content:center"><span>${t('Start Your Booking', 'ابدأ الحجز')}</span><span class="ico">${ARROW}</span></a>
        </div>
        <p class="callnote"><span>${t('Prefer to call?', 'تفضّل الاتصال؟')}</span> <b dir="ltr">+962 790 719 535</b></p>
      </div>
    </div>
  </div>
</section>

</div>

<footer class="footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <span class="mark"><img src="/landing/logo.jpg" alt="The One logo"></span>
        <div style="font-family:var(--ff-display);font-weight:800;color:#fff;font-size:1.2rem;margin-bottom:10px">THE ONE</div>
        <p>${t('Your health. Your recovery. Our mission. Care in every step.', 'صحتك. تعافيك. مهمتنا. رعاية في كل خطوة.')}</p>
        <div class="socials">
          <a href="https://www.facebook.com/theone.PTclinic" target="_blank" rel="noopener" aria-label="Facebook"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v6h3v-6h2.5l.5-3H13v-2c0-.6.4-1 1-1z"/></svg></a>
          <a href="https://www.instagram.com/theone.physicaltherapy/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.linkedin.com/in/the-one-for-physiotherapy-%D8%A7%D9%84%D9%85%D8%B1%D9%83%D8%B2-%D8%A7%D9%84%D8%A3%D9%88%D9%84-%D9%84%D9%84%D8%B9%D9%84%D8%A7%D8%AC-%D8%A7%D9%84%D8%B7%D8%A8%D9%8A%D8%B9%D9%8A-8651522a6/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 8.5v9H4v-9zM5.2 4.5A1.5 1.5 0 1 1 5 7.5a1.5 1.5 0 0 1 .2-3zM20 17.5h-2.5v-4.7c0-1.2-.4-2-1.5-2-1 0-1.5.6-1.5 2v4.7H12v-9h2.4v1.2c.4-.7 1.2-1.4 2.6-1.4 1.9 0 3 1.2 3 3.8z"/></svg></a>
          <a href="https://www.theone-pt.com" target="_blank" rel="noopener" aria-label="Website"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg></a>
        </div>
      </div>
      <div class="foot-col">
        <h4>${t('Quick Links', 'روابط سريعة')}</h4>
        <ul>
          <li><a href="#top">${t('Home', 'الرئيسية')}</a></li>
          <li><a href="#about">${t('About', 'من نحن')}</a></li>
          <li><a href="#services">${t('Services', 'خدماتنا')}</a></li>
          <li><a href="#book">${t('Contact', 'تواصل معنا')}</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h4>${t('Services', 'الخدمات')}</h4>
        <ul>
          <li><a href="#services">${t('Pediatric Physical Therapy', 'علاج طبيعي للأطفال')}</a></li>
          <li><a href="#services">${t('Adults Physical Therapy', 'علاج طبيعي للبالغين')}</a></li>
          <li><a href="#services">${t('Occupational Therapy', 'العلاج الوظيفي')}</a></li>
          <li><a href="#services">${t('Speech Therapy', 'علاج النطق')}</a></li>
          <li><a href="#services">${t('Hydrotherapy', 'العلاج المائي')}</a></li>
          <li><a href="#services">${t('Pediatric Group Therapy', 'علاج جماعي للأطفال')}</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h4>${t('Contact', 'تواصل')}</h4>
        <div class="contact-item"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${t('Al-Madina Al-Munawarah street, Khalaf Washti Complex #233', 'شارع المدينة المنوّرة، مجمّع خلف وشتي #233')}</span></div>
        <div class="contact-item"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg><a href="tel:+962790719535" dir="ltr">+962-790719535</a></div>
        <div class="contact-item"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg><a href="mailto:info@theone-pt.com">info@theone-pt.com</a></div>
        <div class="contact-item"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg><a href="https://www.theone-pt.com" target="_blank" rel="noopener" dir="ltr">www.theone-pt.com</a></div>
      </div>
    </div>
    <div class="foot-bottom">${t('© 2026 The One Physical Therapy Center. All rights reserved.', '© 2026 المركز الأول للعلاج الطبيعي. جميع الحقوق محفوظة.')}</div>
  </div>
</footer>

<a href="tel:+962790719535" class="fab" aria-label="Call us"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg></a>
`;
}
