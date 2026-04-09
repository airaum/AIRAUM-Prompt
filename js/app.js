/**
 * AIRAUM Prompt Refiner — app.js v3
 *
 * 상태 머신: idle | loading | blocked | output (4개 정확히 분리)
 * 입력 오류(empty/short)는 결과 상태를 바꾸지 않고 인라인 메시지로 처리
 * 기능: 테마 토글 · 예시 칩 · 복사 피드백 · 완전 초기화
 * 엔진: refiner.js (변경 없음)
 */
document.addEventListener('DOMContentLoaded', () => {

  /* ── DOM 참조 ── */
  const inputEl    = document.getElementById('user-input');
  const refineBtn  = document.getElementById('refine-btn');
  const langBadge  = document.getElementById('lang-badge');
  const metaBadges = document.getElementById('meta-badges');
  const inputErr   = document.getElementById('input-err');
  const themeBtn   = document.getElementById('theme-btn');
  const toastEl    = document.getElementById('toast');

  // 결과 상태 요소
  const stIdle     = document.getElementById('st-idle');
  const stLoading  = document.getElementById('st-loading');
  const stBlocked  = document.getElementById('st-blocked');
  const stOutput   = document.getElementById('st-output');

  // 결과 콘텐츠
  const blockedMsg = document.getElementById('blocked-msg');
  const resultText = document.getElementById('result-text');

  // 액션 버튼
  const copyBtn    = document.getElementById('copy-btn');
  const resetBtn   = document.getElementById('reset-btn');

  /* ══════════════════════════════
     테마 (다크/라이트)
     ══════════════════════════════ */
  // data-theme icon: 현재 테마의 아이콘 (클릭하면 반대로 전환)
  const THEME_ICON = { light: '☾', dark: '☀' };

  function applyTheme(theme, save) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = THEME_ICON[theme];
    themeBtn.setAttribute(
      'aria-label',
      theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'
    );
    if (save) localStorage.setItem('airaum-theme', theme);
  }

  function initTheme() {
    // localStorage → 없으면 시스템 설정
    const saved = localStorage.getItem('airaum-theme');
    const sys   = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved || sys, false);
  }

  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    applyTheme(cur === 'dark' ? 'light' : 'dark', true);
  });

  // 사용자가 수동으로 선택하지 않은 경우에만 시스템 변경 반영
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('airaum-theme')) {
      applyTheme(e.matches ? 'dark' : 'light', false);
    }
  });

  initTheme();

  /* ══════════════════════════════
     예시 칩
     ══════════════════════════════ */
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      inputEl.value = chip.dataset.fill;
      inputEl.dispatchEvent(new Event('input')); // 언어 감지 트리거
      inputEl.focus();
    });
  });

  /* ══════════════════════════════
     실시간 언어 감지
     ══════════════════════════════ */
  inputEl.addEventListener('input', () => {
    const text = inputEl.value.trim();
    if (text.length >= 2) {
      const lang = Refiner.detectLang(text);
      langBadge.textContent = lang === 'ko' ? '한국어' : 'English';
      langBadge.hidden = false;
    } else {
      langBadge.hidden = true;
    }
    // 타이핑 시 인라인 오류 초기화
    if (!inputErr.hidden) inputErr.hidden = true;
  });

  /* ═════════════════════════════════════
     상태 머신 — 4상태 완전 격리
     idle | loading | blocked | output
     ═════════════════════════════════════ */
  function showState(state) {
    // 결과 상태: 해당하는 것 하나만 표시
    stIdle.hidden    = state !== 'idle';
    stLoading.hidden = state !== 'loading';
    stBlocked.hidden = state !== 'blocked';
    stOutput.hidden  = state !== 'output';

    // 액션 버튼: output 상태일 때만 복사 표시, idle이 아닐 때 초기화 표시
    copyBtn.hidden   = state !== 'output';
    resetBtn.hidden  = state === 'idle';

    // 메타 뱃지: output 상태일 때만 표시
    metaBadges.hidden = state !== 'output';

    // 상태 바뀔 때 내부 스크롤을 맨 위로 초기화
    stOutput.scrollTop = 0;
    stBlocked.scrollTop = 0;
  }

  /* ══════════════════════════════
     정제 실행
     ══════════════════════════════ */
  function runRefine() {
    // 인라인 오류 초기화
    inputErr.hidden = true;

    showState('loading');
    refineBtn.disabled = true;

    // 최소 280ms 로딩 표시 (스위프 바가 보여야 의미 있음)
    setTimeout(() => {
      const result = Refiner.refine(inputEl.value);

      if (result.error) {
        if (result.blocked) {
          // 안전 차단: blocked 상태로 전환
          blockedMsg.textContent = result.message;
          // 이전 결과/메타 완전 제거
          resultText.textContent = '';
          metaBadges.innerHTML = '';
          showState('blocked');
        } else {
          // 입력 오류(empty/too-short): 결과 상태 변경 없이 인라인 메시지
          showState('idle');
          inputErr.textContent = result.message;
          inputErr.hidden = false;
        }
        refineBtn.disabled = false;
        return;
      }

      // 정상 결과
      resultText.textContent = result.result;
      renderBadges(result);
      showState('output');
      refineBtn.disabled = false;
    }, 280);
  }

  refineBtn.addEventListener('click', runRefine);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runRefine();
    }
  });

  /* ══════════════════════════════
     메타 뱃지 렌더링 (모노크롬)
     ══════════════════════════════ */
  const LABELS = {
    ot:   { report:'보고서', explanation:'설명', ideaList:'아이디어', plan:'기획안', comparison:'비교', contentPlan:'콘텐츠기획', copywriting:'카피', actionPlan:'액션플랜' },
    task: { research:'조사', ideation:'발상', writing:'작성', content:'콘텐츠', dev:'개발', compare:'비교', learning:'학습', decision:'전략' },
    int:  { strong:'강보정', moderate:'보정', light:'경보정' },
  };

  function renderBadges(r) {
    metaBadges.innerHTML = '';
    [
      [LABELS.ot[r.outputType],   '산출물 유형'],
      [LABELS.task[r.task],       '작업 범주'],
      [LABELS.int[r.intensity],   '보정 강도'],
    ].forEach(([label, title]) => {
      if (!label) return;
      const b = document.createElement('span');
      b.className   = 'badge';
      b.textContent = label;
      b.title       = title;
      metaBadges.appendChild(b);
    });
  }

  /* ══════════════════════════════
     복사 (버튼 피드백)
     ══════════════════════════════ */
  copyBtn.addEventListener('click', async () => {
    const text = resultText.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 폴백 (구형 브라우저)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    // 버튼 텍스트로 피드백
    const orig = copyBtn.textContent;
    copyBtn.textContent = '복사됨 ✓';
    copyBtn.disabled    = true;
    setTimeout(() => {
      copyBtn.textContent = orig;
      copyBtn.disabled    = false;
    }, 1600);
  });

  /* ══════════════════════════════
     초기화 — 완전 리셋
     ══════════════════════════════ */
  resetBtn.addEventListener('click', () => {
    inputEl.value      = '';
    inputErr.hidden    = true;
    langBadge.hidden   = true;
    metaBadges.innerHTML = '';
    resultText.textContent = '';
    blockedMsg.textContent = '';
    showState('idle');
    inputEl.focus();
  });

  /* ══════════════════════════════
     초기 상태
     ══════════════════════════════ */
  showState('idle');
});
