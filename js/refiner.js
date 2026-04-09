/**
 * AIRAUM Prompt Refiner - 정제 엔진 v4
 *
 * 핵심 변경: 산출물 유형 우선 라우팅 + 3층 규칙 + 변주 시스템
 *
 * 처리 흐름:
 *   detectLang → assessSafety → measureInputQuality
 *   → detectOutputType → detectTask → route
 *   → extractSubject + extractContext → analyzeGaps
 *   → synthesize (buildKo / buildEn)
 *   → postCheck → return
 *
 * 규칙 우선순위: safety > outputType > task > format > style
 */

const Refiner = (() => {

  // ═══════════════════════════════════════════
  // 1. 유틸리티
  // ═══════════════════════════════════════════

  function detectLang(text) {
    return (text.match(/[가-힣]/g) || []).length >= 2 ? 'ko' : 'en';
  }

  // 변주 선택: 산출물 유형 + 보정 강도 기반 (deterministic)
  const OT_IDX = { report: 0, explanation: 1, ideaList: 2, plan: 3, comparison: 4, contentPlan: 5, copywriting: 6, actionPlan: 7 };
  const INT_OFF = { strong: 0, moderate: 1, light: 2 };

  function pickVar(pool, outputType, intensity) {
    const idx = ((OT_IDX[outputType] || 0) + (INT_OFF[intensity] || 0)) % pool.length;
    return pool[idx];
  }

  // ═══════════════════════════════════════════
  // 2. 안전 판정 — 3단계 (allow / caution / block)
  // ═══════════════════════════════════════════

  const BLOCK_PATTERNS = [
    // 1. 성범죄/비동의/약물 이용 성적 접근
    { keywords: ['약을 먹', '약을 타', '수면제', '물뽕', 'GHB', '데이트 약물', 'date rape', 'drug her', 'drug him', 'spike drink', 'rohypnol'],
      intents: ['꼬시', '관계', '데려', '재우', '성관계', '몰래', 'seduce', 'sex', 'unconscious'] },
    { keywords: ['몰카', '불법촬영', '도촬', '숨긴 카메라', 'hidden camera', 'spy cam', 'upskirt'],
      intents: [] },
    { keywords: ['딥페이크', 'deepfake', '합성 음란'],
      intents: ['제작', '만들', 'create', 'make', 'generate'] },
    // 2. 약물/독극물/무력화
    { keywords: ['독극물', '청산가리', '사린', '치사량', '합성법', '제조법', 'poison synthesis', 'lethal dose', 'nerve agent'],
      intents: [] },
    { keywords: ['마약', '필로폰', '메스암페타민', '코카인', 'meth', 'cocaine', 'fentanyl'],
      intents: ['만들', '제조', '합성', '구매', 'synthesize', 'cook', 'make', 'buy'] },
    // 3. 폭력/범죄 실행
    { keywords: ['살인', '살해', '죽이', 'murder', 'kill someone', 'how to kill'],
      intents: ['방법', '실행', '계획', 'method', 'plan', 'how'] },
    { keywords: ['납치', '감금', '협박', 'kidnap', 'abduct', 'blackmail', 'extort'],
      intents: ['방법', '하려면', '하는 법', 'how to'] },
    // 4. 사기/기만/불법 수익
    { keywords: ['보이스피싱', '피싱', '스캠', '사기 대본', 'phishing script', 'scam template', 'fraud scheme'],
      intents: ['만들', '작성', '대본', 'create', 'write', 'template'] },
    { keywords: ['돈세탁', '자금세탁', 'money laundering', 'launder money'],
      intents: [] },
    // 5. 해킹/침입/우회
    { keywords: ['해킹', '크래킹', '랜섬웨어', 'ransomware', 'malware', 'keylogger'],
      intents: ['만들', '제작', '배포', 'create', 'deploy', 'build'] },
    { keywords: ['비밀번호 크랙', 'crack password', 'brute force', 'SQL injection', 'XSS attack'],
      intents: ['방법', '하려면', '실행', '하는 법', 'how to', 'tutorial'] },
    { keywords: ['DDoS', 'ddos', '디도스'],
      intents: ['공격', '실행', 'attack', 'launch'] },
    // 6. 계정 탈취/크래킹 (v4 신규)
    { keywords: ['계정'],
      intents: ['뚫', '해킹', '크랙', '탈취', '빼앗', 'hack', 'crack', 'break into', 'steal'] },
    // 7. 개인정보 침해/스토킹 (v4 강화)
    { keywords: ['개인정보 탈취', '신상 털기', '스토킹', '위치 추적', 'doxxing', 'stalk', 'track location'],
      intents: ['방법', '하려면', '하는 법', '하는 방법', '몰래', 'how to', 'secretly', 'without knowing'] },
    { keywords: ['신용카드 위조', '문서 위조', 'forge document', 'fake ID', 'counterfeit'],
      intents: [] },
    // 8. 자해/자살 실행법
    { keywords: ['자살 방법', '자해 방법', '목숨을 끊', 'suicide method', 'how to kill myself', 'self-harm method'],
      intents: [] },
    // 9. 폭발물/무기/독성 제조
    { keywords: ['폭탄', '폭발물', '총기 제작', '화약', '기폭', 'bomb', 'explosive', 'build a weapon', 'gunpowder', 'detonator'],
      intents: ['만들', '제작', '제조', 'make', 'build', 'create'] },
    // 10. 미성년자 성적/착취
    { keywords: ['아동 성', '미성년 성', '아동 착취', '아동 포르노', 'child porn', 'child sexual', 'CSAM', 'minor exploit'],
      intents: [] },
    // 11. 저작권 침해 조장
    { keywords: ['저작권 우회', '불법 다운', '크랙 버전', '토렌트 배포', 'bypass copyright', 'pirate', 'crack software', 'torrent distribute'],
      intents: ['방법', '하려면', '하는 법', 'how to'] },
  ];

  const CAUTION_PATTERNS_KO = [
    { category: '의료', keywords: ['처방', '약 복용', '진단', '수술', '질병 치료', '증상'] },
    { category: '법률', keywords: ['고소', '소송', '법적 책임', '형사', '민사', '변호사'] },
    { category: '금융', keywords: ['투자 조언', '주식 추천', '코인 추천', '대출', '세금 절감', '탈세'] },
    { category: '고용', keywords: ['해고', '부당해고', '노동법', '퇴직금', '근로계약'] },
  ];
  const CAUTION_PATTERNS_EN = [
    { category: 'medical', keywords: ['prescription', 'dosage', 'diagnosis', 'surgery', 'treatment', 'symptom'] },
    { category: 'legal', keywords: ['lawsuit', 'sue', 'legal liability', 'criminal charge', 'attorney'] },
    { category: 'financial', keywords: ['investment advice', 'stock pick', 'crypto recommendation', 'tax evasion'] },
    { category: 'employment', keywords: ['wrongful termination', 'labor law', 'severance', 'employment contract'] },
  ];

  const SAFE_CONTEXT_KO = ['예방', '방지', '대처', '신고', '보호', '교육', '연구', '분석', '요약', '설명', '역사', '사례', '통계', '정책', '법률 검토', '논문'];
  const SAFE_CONTEXT_EN = ['prevent', 'protect', 'report', 'educate', 'research', 'analyze', 'summarize', 'explain', 'history', 'case study', 'statistics', 'policy', 'legal review', 'academic'];

  function assessSafety(text, lang) {
    const lower = text.toLowerCase();
    const safeCtx = lang === 'ko' ? SAFE_CONTEXT_KO : SAFE_CONTEXT_EN;
    const hasSafeContext = safeCtx.some(s => lower.includes(s));

    for (const pattern of BLOCK_PATTERNS) {
      const hasKeyword = pattern.keywords.some(kw => lower.includes(kw.toLowerCase()));
      if (!hasKeyword) continue;
      if (pattern.intents.length === 0) {
        if (hasSafeContext) return { level: 'caution', category: 'sensitive-with-safe-context' };
        return { level: 'block', category: 'dangerous' };
      }
      const hasIntent = pattern.intents.some(i => lower.includes(i.toLowerCase()));
      if (hasIntent) {
        if (hasSafeContext) return { level: 'caution', category: 'sensitive-with-safe-context' };
        return { level: 'block', category: 'dangerous' };
      }
    }

    const cautionPatterns = lang === 'ko' ? CAUTION_PATTERNS_KO : CAUTION_PATTERNS_EN;
    for (const cp of cautionPatterns) {
      if (cp.keywords.some(kw => lower.includes(kw))) {
        return { level: 'caution', category: cp.category };
      }
    }

    return { level: 'allow', category: null };
  }

  // ═══════════════════════════════════════════
  // 3. 입력 품질 측정 → 보정 강도 결정
  // ═══════════════════════════════════════════

  function measureInputQuality(text, lang) {
    let score = 0;
    const lower = text.toLowerCase();

    // 길이 (0~3)
    if (text.length > 100) score += 3;
    else if (text.length > 50) score += 2;
    else if (text.length > 20) score += 1;

    // 구조 힌트 (0~3)
    const hints = lang === 'ko'
      ? ['목적', '대상', '형식', '범위', '기준', '조건', '제외', '포함', '단계', '우선순위', '예산', '기간', '지역']
      : ['purpose', 'audience', 'format', 'scope', 'criteria', 'constraint', 'exclude', 'include', 'step', 'priority', 'budget', 'timeline', 'region'];
    score += Math.min(hints.filter(h => lower.includes(h)).length, 3);

    // 구체 정보 (0~2)
    if (/\d/.test(text)) score += 1;
    if (text.includes(',') || text.includes('·') || text.includes('/')) score += 1;

    // 문장 수 (0~2)
    const sentences = text.split(/[.!?。]\s*/).filter(s => s.trim().length > 0);
    if (sentences.length >= 3) score += 2;
    else if (sentences.length >= 2) score += 1;

    if (score <= 3) return { quality: 'low', intensity: 'strong', score };
    if (score <= 6) return { quality: 'medium', intensity: 'moderate', score };
    return { quality: 'high', intensity: 'light', score };
  }

  // ═══════════════════════════════════════════
  // 4. 산출물 유형 감지 — v4 핵심 (8종)
  //    우선순위: 구체적 유형 먼저, 범용적 유형 나중에
  // ═══════════════════════════════════════════

  const OUTPUT_TYPE_RULES_KO = [
    { type: 'report',      keywords: ['보고서', '리포트', '레포트', '현황 보고', '분석 보고'] },
    { type: 'copywriting',  keywords: ['카피', '문구', '슬로건', '광고문', '헤드라인', '문안', '태그라인'] },
    { type: 'actionPlan',   keywords: ['실행 계획', '로드맵', '일정표', '액션플랜', '단계별 계획'] },
    { type: 'contentPlan',  keywords: ['콘텐츠 기획', '콘텐츠 전략', '콘텐츠 캘린더', '채널 운영'] },
    { type: 'comparison',   keywords: ['비교', '장단점', 'vs', '대조', '뭐가 나', '어떤 게 나', '차이'] },
    { type: 'plan',         keywords: ['기획안', '기획서', '제안서', '전략안', '사업계획', '전략'] },
    { type: 'ideaList',     keywords: ['아이디어', '브레인스토밍', '후보', '네이밍', '이름 추천', '이름 짓', '컨셉'] },
    { type: 'explanation',  keywords: ['설명해', '알려줘', '뭐야', '무엇', '어떻게', '왜 ', '원리', '에 대해'] },
  ];
  const OUTPUT_TYPE_RULES_EN = [
    { type: 'report',      keywords: ['report', 'summary report', 'analysis report', 'write-up', 'overview'] },
    { type: 'copywriting',  keywords: ['copy', 'slogan', 'tagline', 'headline', 'ad text', 'catchphrase'] },
    { type: 'actionPlan',   keywords: ['action plan', 'step-by-step plan', 'timeline', 'checklist', 'todo list'] },
    { type: 'contentPlan',  keywords: ['content plan', 'content strategy', 'content calendar', 'editorial plan'] },
    { type: 'comparison',   keywords: ['compare', 'pros and cons', 'vs', 'versus', 'which is better', 'difference'] },
    { type: 'plan',         keywords: ['proposal', 'strategic plan', 'business plan', 'blueprint', 'strategy'] },
    { type: 'ideaList',     keywords: ['idea', 'brainstorm', 'options', 'alternatives', 'candidates', 'naming'] },
    { type: 'explanation',  keywords: ['explain', 'what is', 'how does', 'why', 'describe', 'tell me about'] },
  ];

  function detectOutputType(text, lang) {
    const lower = text.toLowerCase();
    const rules = lang === 'ko' ? OUTPUT_TYPE_RULES_KO : OUTPUT_TYPE_RULES_EN;
    for (const rule of rules) {
      if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) return rule.type;
    }
    return null;
  }

  // ═══════════════════════════════════════════
  // 5. 작업 범주 감지 — 8종 (점수 기반)
  // ═══════════════════════════════════════════

  const TASK_RULES_KO = [
    { task: 'research',  keywords: ['조사', '분석', '리서치', '시장', '경쟁사', '트렌드', '동향', '벤치마크', '상권', '현황'] },
    { task: 'ideation',  keywords: ['기획', '발상', '브레인스토밍'] },
    { task: 'writing',   keywords: ['작성', '써줘', '써 줘', '초안', '원고', '이력서', '자소서', '소개서', '문서'] },
    { task: 'content',   keywords: ['인스타', '블로그', '유튜브', '틱톡', 'SNS', '콘텐츠', '포스팅', '릴스', '마케팅', '광고', '홍보'] },
    { task: 'dev',       keywords: ['개발', '코드', '프로그래밍', '구현', '앱', '웹사이트', 'API', '자동화', '스크립트', '봇', '서버'] },
    { task: 'compare',   keywords: ['선정', '추천', '뭐가 좋', '어떤 걸'] },
    { task: 'learning',  keywords: ['공부', '학습', '이해', '개념', '원리', '입문', '기초'] },
    { task: 'decision',  keywords: ['결정', '판단', '의사결정', '전략', '방향', '수립', 'KPI', 'OKR'] },
  ];
  const TASK_RULES_EN = [
    { task: 'research',  keywords: ['research', 'analyze', 'survey', 'market', 'competitor', 'trend', 'benchmark', 'landscape'] },
    { task: 'ideation',  keywords: ['brainstorm', 'concept', 'creative', 'ideate'] },
    { task: 'writing',   keywords: ['write', 'draft', 'document', 'resume', 'cover letter', 'brief', 'manuscript'] },
    { task: 'content',   keywords: ['instagram', 'blog', 'youtube', 'tiktok', 'social media', 'content', 'post', 'marketing', 'ad', 'campaign'] },
    { task: 'dev',       keywords: ['develop', 'code', 'program', 'build', 'app', 'website', 'API', 'automate', 'script', 'bot', 'server'] },
    { task: 'compare',   keywords: ['select', 'recommend', 'pick', 'which one'] },
    { task: 'learning',  keywords: ['learn', 'understand', 'concept', 'principle', 'study', 'beginner', 'basics'] },
    { task: 'decision',  keywords: ['decide', 'decision', 'evaluate', 'assess', 'strategy', 'direction', 'KPI', 'OKR'] },
  ];

  // 산출물 유형 → 기본 작업 범주 매핑
  const OUTPUT_TYPE_TASK_AFFINITY = {
    report: 'writing', explanation: 'learning', ideaList: 'ideation',
    plan: 'decision', comparison: 'compare', contentPlan: 'content',
    copywriting: 'content', actionPlan: 'dev',
  };

  // 작업 범주 → 기본 산출물 유형 매핑 (산출물 유형 미감지 시 폴백)
  const TASK_DEFAULT_OUTPUT = {
    research: 'report', ideation: 'ideaList', writing: 'report',
    content: 'contentPlan', dev: 'actionPlan', compare: 'comparison',
    learning: 'explanation', decision: 'plan',
  };

  // 동점 시 우선순위
  const TASK_TIEBREAK = ['content', 'dev', 'compare', 'research', 'ideation', 'decision', 'learning', 'writing'];

  function detectTask(text, lang, outputType) {
    const lower = text.toLowerCase();
    const rules = lang === 'ko' ? TASK_RULES_KO : TASK_RULES_EN;

    const scores = {};
    for (const rule of rules) {
      scores[rule.task] = rule.keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
    }

    // 산출물 유형 친화도 보너스 (+0.5)
    if (outputType) {
      const affinity = OUTPUT_TYPE_TASK_AFFINITY[outputType];
      if (affinity && scores[affinity] > 0) scores[affinity] += 0.5;
    }

    // 최고 점수 찾기
    let best = null, bestScore = 0;
    for (const [task, score] of Object.entries(scores)) {
      if (score > bestScore || (score === bestScore && score > 0 && TASK_TIEBREAK.indexOf(task) < TASK_TIEBREAK.indexOf(best))) {
        best = task;
        bestScore = score;
      }
    }

    // 매치가 없으면 산출물 유형의 기본 작업 범주 사용
    if (bestScore === 0 && outputType) {
      return OUTPUT_TYPE_TASK_AFFINITY[outputType] || 'writing';
    }

    return best || 'writing';
  }

  // 최종 라우팅: 산출물 유형 + 작업 범주 결합
  function route(text, lang) {
    const outputType = detectOutputType(text, lang);
    const task = detectTask(text, lang, outputType);
    const finalOutputType = outputType || TASK_DEFAULT_OUTPUT[task] || 'report';
    return { outputType: finalOutputType, task };
  }

  // ═══════════════════════════════════════════
  // 6. 주제 추출 + 맥락 정보 추출
  // ═══════════════════════════════════════════

  const NOISE_KO = /(?:좋게|잘|멋지게|대충|알아서|완벽하게|적당히|그냥|좀|제발|부탁|해줘|해\s*주세요|만들어\s*줘|만들어\s*주세요|알려\s*줘|알려\s*주세요|찾아\s*줘|찾아\s*주세요|줘|주세요|줄래|할래|하고\s*싶어|하고\s*싶은데|해야\s*해|해야\s*돼|정해야\s*해|정해야\s*돼|정해\s*줘|써\s*줘|짓자|짜줘|짜\s*줘|제시해\s*줘|제시해|추천해\s*줘|추천해)\s*/g;
  const NOISE_EN = /\b(?:please|just|kindly|nicely|perfectly|somehow|kinda|sort of|I guess|maybe|like|I want to|I need to|I'd like to|can you|could you|help me|for me|a good|a great|a nice|the best|give me|make me)\b\s*/gi;

  function extractSubject(text, lang) {
    let s = lang === 'ko' ? text.replace(NOISE_KO, ' ') : text.replace(NOISE_EN, ' ');
    return s.replace(/[.,!?;:"""''…~]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function extractContext(text, lang) {
    const ctx = {};
    if (lang === 'ko') {
      const regions = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
      const foundRegion = regions.find(r => text.includes(r));
      if (foundRegion) ctx.region = foundRegion;
      const bizMatch = text.match(/(헬스장|카페|음식점|식당|미용실|학원|병원|약국|쇼핑몰|호텔|펜션|스튜디오|사무실|공유오피스|코워킹|베이커리|꽃집|서점|세탁소|편의점|PC방|노래방|당구장|볼링장|골프|필라테스|요가|PT|피트니스|체육관|gym|cafe|restaurant|salon|clinic)/i);
      if (bizMatch) ctx.business = bizMatch[1];
      const compMatch = text.match(/(\d+)\s*(?:개|곳|군데)/);
      if (compMatch) ctx.count = compMatch[1];
      if (/가격|비용|요금|단가|견적|price|cost|fee/i.test(text)) ctx.priceAnalysis = true;
    } else {
      const regionMatch = text.match(/\b(?:in|at|near|around)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/);
      if (regionMatch) ctx.region = regionMatch[1];
      if (/price|cost|fee|rate|pricing/i.test(text)) ctx.priceAnalysis = true;
    }
    return ctx;
  }

  // ═══════════════════════════════════════════
  // 7. 갭 분석 — 통합
  //    자동보정 범위: aggressive(목적,형식,기준,제약,우선순위,불확실성)
  //                   cautious(독자,범위,최신성)
  //    자동보정 금지: 지역,플랫폼,고객군,업종,기간,예산
  // ═══════════════════════════════════════════

  function analyzeGaps(text, lang, task) {
    const lower = text.toLowerCase();
    const gaps = {};
    const check = (hints) => !hints.some(h => lower.includes(h));

    // 공통 갭 (aggressive)
    gaps.purposeMissing = check(lang === 'ko'
      ? ['위해', '목적', '이유는', '하려고', '결정', '판단', '위한', '원해']
      : ['in order to', 'purpose', 'goal', 'to decide', 'to determine', 'aim']);
    gaps.constraintsMissing = check(lang === 'ko'
      ? ['예산', '비용', '무료', '기간', '인원', '1인', '소규모', '제한']
      : ['budget', 'cost', 'free', 'timeline', 'team size', 'solo', 'small', 'constraint']);

    // 저해상도 표현 탐지 (aggressive)
    const vagueHints = lang === 'ko'
      ? ['좋은', '괜찮은', '추천', '최고', '적합한', '효과적', '잘 되는', '인기']
      : ['good', 'best', 'recommend', 'suitable', 'effective', 'popular', 'top'];
    gaps.criteriaMissing = vagueHints.some(h => lower.includes(h));

    // 공통 갭 (cautious)
    gaps.audienceMissing = check(lang === 'ko'
      ? ['대상', '독자', '타깃', '고객', '사용자', '초보', '전문가', '팀', '상사', '클라이언트']
      : ['audience', 'reader', 'target', 'customer', 'user', 'beginner', 'expert', 'team', 'client']);
    gaps.scopeMissing = check(lang === 'ko'
      ? ['범위', '한정', '국내', '해외', '분야', '업종', '카테고리', '중에서']
      : ['scope', 'limited to', 'domestic', 'global', 'sector', 'industry', 'category']);

    // 작업별 추가 갭
    if (task === 'research') {
      gaps.needsRecency = true;
      gaps.compAxisMissing = check(lang === 'ko'
        ? ['가격', '품질', '점유율', '규모', '매출'] : ['price', 'quality', 'market share', 'revenue', 'size']);
    }
    if (task === 'content') {
      gaps.needsRecency = true;
      gaps.hookMissing = true;
      gaps.toneMissing = check(lang === 'ko'
        ? ['톤', '분위기', '감성', '유머', '진지', '전문'] : ['tone', 'mood', 'humor', 'serious', 'professional', 'casual']);
    }
    if (task === 'dev') {
      gaps.featuresMissing = check(lang === 'ko'
        ? ['기능', '페이지', '화면', '로그인', '결제', '회원', '검색', '업로드']
        : ['feature', 'page', 'screen', 'login', 'payment', 'user', 'search', 'upload']);
      gaps.techStackMissing = check(lang === 'ko'
        ? ['React', 'Vue', 'Next', 'HTML', 'Python', 'Node', 'WordPress', '노코드']
        : ['React', 'Vue', 'Next', 'HTML', 'Python', 'Node', 'WordPress', 'no-code']);
      gaps.mvpMissing = !(['MVP', 'mvp', '최소', '1차', 'minimum', 'first version'].some(h => lower.includes(h)));
    }
    if (task === 'writing') {
      gaps.lengthMissing = check(lang === 'ko'
        ? ['분량', '페이지', '장', '단', 'A4', '간단', '상세'] : ['length', 'page', 'brief', 'detailed', 'short', 'comprehensive']);
      gaps.toneMissing = check(lang === 'ko'
        ? ['톤', '격식', '비격식', '공식', '캐주얼'] : ['tone', 'formal', 'informal', 'official', 'casual']);
    }
    if (task === 'ideation') {
      gaps.countMissing = !(/\d/.test(text) || (lang === 'ko' ? ['몇 개', '몇가지'].some(h => lower.includes(h)) : ['how many', 'number of'].some(h => lower.includes(h))));
      gaps.feasibilityMissing = check(lang === 'ko'
        ? ['실현', '현실', '가능', '실행', '바로'] : ['feasible', 'realistic', 'actionable', 'practical']);
    }
    if (task === 'compare') {
      gaps.axisMissing = check(lang === 'ko'
        ? ['가격', '성능', '비용', '속도', '난이도', '편의'] : ['price', 'performance', 'cost', 'speed', 'difficulty', 'ease']);
      gaps.conclusionMissing = check(lang === 'ko'
        ? ['결론', '추천', '선택', '결정'] : ['conclusion', 'recommend', 'choose', 'decide']);
    }
    if (task === 'learning') {
      gaps.levelMissing = check(lang === 'ko'
        ? ['초보', '입문', '중급', '고급', '기초', '심화'] : ['beginner', 'introductory', 'intermediate', 'advanced', 'basic']);
      gaps.exampleMissing = check(lang === 'ko'
        ? ['예시', '예를 들', '사례'] : ['example', 'for instance', 'case']);
    }
    if (task === 'decision') {
      gaps.needsRecency = true;
      gaps.timeframeMissing = check(lang === 'ko'
        ? ['개월', '주', '분기', '년', '단기', '중기', '장기'] : ['month', 'week', 'quarter', 'year', 'short-term', 'mid-term', 'long-term']);
    }

    return gaps;
  }

  // ═══════════════════════════════════════════
  // 8. 변주 풀 — 반복 문구 3종 변주
  //    선택: pickVar(pool, outputType, intensity)
  // ═══════════════════════════════════════════

  const VAR_KO = {
    excl_filler: [
      '의미 없는 인사말, 감탄사, 반복 문장을 포함하지 마라',
      '불필요한 서두, 감정적 수식어, 중복 표현을 제거하라',
      '인사성 문장, 장식적 반복, 감탄사를 배제하라',
    ],
    excl_fabricate: [
      '입력에 없는 전제를 임의로 창작하지 마라',
      '사용자가 제공하지 않은 조건을 만들어내지 마라',
      '원문에 근거 없는 가정을 추가하지 마라',
    ],
    excl_padding: [
      '일반론이나 교과서적 정의 나열로 분량을 채우지 마라',
      '누구나 아는 상식 반복으로 분량을 늘리지 마라',
      '배경 설명이나 원론적 서술로 길이를 부풀리지 마라',
    ],
    unc_limit: [
      '확인되지 않은 세부 사항은 "일반적 기준"으로 한정하고 단정하지 마라',
      '검증되지 않은 정보는 "보수적 가정" 범위로 처리하라',
      '불확실한 부분은 "통상적 범위"로 한정하되 추정임을 밝혀라',
    ],
    unc_flag: [
      '추정이 포함된 경우 해당 부분을 명시하라',
      '추론에 기반한 서술은 그 근거를 함께 제시하라',
      '가정이 들어간 부분은 별도로 표기하라',
    ],
    real_action: [
      '추상론보다 실제 작업 순서를 우선하라',
      '이론적 설명보다 바로 실행 가능한 절차를 앞세워라',
      '원론보다 구체적 행동 단계를 먼저 제시하라',
    ],
    real_priority: [
      '선택지가 있으면 우선순위와 이유를 함께 제시하라',
      '여러 안이 나올 경우 추천 순서와 근거를 밝혀라',
      '복수의 옵션은 실행 용이성 기준으로 순위를 매겨라',
    ],
  };
  const VAR_EN = {
    excl_filler: [
      'Do not include filler greetings, exclamations, or redundant sentences',
      'Remove unnecessary preamble, emotional modifiers, and repeated points',
      'Exclude pleasantries, decorative repetition, and exclamatory phrases',
    ],
    excl_fabricate: [
      'Do not fabricate premises absent from the input',
      'Do not invent conditions the user did not provide',
      'Do not add assumptions without basis in the original input',
    ],
    excl_padding: [
      'Do not pad length with generic definitions or textbook explanations',
      'Do not repeat commonly known information to inflate length',
      'Do not bulk up the response with background or theoretical filler',
    ],
    unc_limit: [
      'Limit unverified details to "general standards" or "conservative assumptions"',
      'Treat unconfirmed information within "conservative estimate" boundaries',
      'Constrain uncertain points to "typical ranges" and flag them as estimates',
    ],
    unc_flag: [
      'Flag any estimates or inferences explicitly',
      'When reasoning is inference-based, present supporting evidence',
      'Mark sections containing assumptions separately',
    ],
    real_action: [
      'Prioritize actionable steps over abstract theory',
      'Lead with executable procedures rather than theoretical explanations',
      'Present concrete action steps before general principles',
    ],
    real_priority: [
      'When presenting options, include priorities and rationale',
      'If multiple options arise, rank them with reasoning',
      'Rank multiple options by implementation feasibility',
    ],
  };

  // ═══════════════════════════════════════════
  // 9. 산출물 유형별 출력 형식 설정
  // ═══════════════════════════════════════════

  const OUTPUT_FORMAT_KO = {
    report:      '요약(3줄 이내) → 현황/배경 → 분석 본문(소제목별 구분) → 시사점 또는 결론 → 다음 단계 순서로 구성하라.',
    explanation: '핵심 정의(1~2문장) → 단계별 설명 → 구체적 예시 → 흔한 오해/주의사항 → 다음 학습 방향 순서로 구성하라.',
    ideaList:    '후보 3~5개를 제시하되, 각 안에 ① 이름/컨셉 ② 핵심 특징 ③ 적합 대상 ④ 장단점 ⑤ 실행 난이도를 포함하라. 마지막에 추천 1순위와 이유를 명시하라.',
    plan:        '목표 정의 → 현황 요약 → 전략/방향 옵션(2~3개, 비교표 포함) → 추천안 및 즉시 실행 항목 순서로 구성하라.',
    comparison:  '비교 기준 명시 → 항목별 대조(표 포함) → 상황별 추천 → 최종 결론 순서로 구성하라.',
    contentPlan: '타깃 정의 → 핵심 메시지 → 콘텐츠 후보 3~5개(각각 포맷, 톤, 훅, 제작 난이도 포함) → 우선순위 순서로 구성하라.',
    copywriting: '목적/타깃 정의 → 핵심 메시지 1문장 → 문구 후보 3~5개(각각 톤, 사용 맥락 표기) → 최종 추천안 순서로 구성하라.',
    actionPlan:  '목표 → 단계별 태스크(담당/기한 포함) → 우선순위 표시 → 완료 기준 체크리스트 순서로 구성하라.',
  };
  const OUTPUT_FORMAT_EN = {
    report:      'Structure as: Executive summary (3 lines max) → Background/current state → Analysis body (organized by subheadings) → Implications or conclusions → Next steps.',
    explanation: 'Structure as: Core definition (1-2 sentences) → Step-by-step explanation → Concrete examples → Common misconceptions/caveats → Next learning direction.',
    ideaList:    'Present 3-5 candidates, each with: ① Name/concept ② Key trait ③ Best-fit scenario ④ Pros/cons ⑤ Difficulty. End with a recommended #1 pick and why.',
    plan:        'Structure as: Goal definition → Situation summary → Strategic options (2-3, with comparison table) → Recommended option with immediate action items.',
    comparison:  'Structure as: Comparison criteria → Side-by-side comparison (with table) → Scenario-based recommendations → Final conclusion.',
    contentPlan: 'Structure as: Target definition → Core message → 3-5 content ideas (each with format, tone, hook, production difficulty) → Priority ranking.',
    copywriting: 'Structure as: Purpose/target definition → Core message (1 sentence) → 3-5 copy candidates (each with tone, usage context) → Final recommendation.',
    actionPlan:  'Structure as: Goal → Phased tasks (with owners/deadlines) → Priority markers → Completion criteria checklist.',
  };

  // ═══════════════════════════════════════════
  // 10. 작업 범주별 설정 (역할, 동사, 목적, 독자, 범위, 원칙, 제외)
  // ═══════════════════════════════════════════

  const TASK_CONFIG_KO = {
    research: {
      role: '시장 분석 및 경쟁 환경 조사에 능한 리서치 전문가',
      verbs: ['조사 대상의 현황을 파악하라', '경쟁 구도를 동일 기준 축으로 비교 분석하라', '핵심 수치와 근거를 제시하라', '리스크와 시사점을 도출하라'],
      defaultPurpose: '현 상황을 파악하고 의사결정을 위한 근거를 확보하는 것',
      defaultAudience: '실무 의사결정자 또는 기획 담당자',
      defaultScope: '핵심 상위 3~5개 항목으로 범위를 한정하라.',
      principles: [
        '판단에는 반드시 수치 또는 출처 기반 근거를 함께 제시하라',
        '비교 시 동일한 기준 축(비용, 규모, 성장성 등)을 적용하라',
        '사실과 추론을 명확히 구분하라',
      ],
      exclusions: ['출처 없는 수치를 확정적으로 서술하지 마라'],
    },
    ideation: {
      role: '다양한 선택지를 구조적으로 제안하는 아이디어 기획자',
      verbs: ['차별화된 후보를 제안하라', '각 안의 핵심 특징과 적합 이유를 설명하라', '실행 난이도와 예상 효과를 비교하라', '바로 시작할 수 있는 1순위 안을 명시하라'],
      defaultPurpose: '실행 가능한 후보군을 도출하고 비교하여 최적안을 선택하는 것',
      defaultAudience: '아이디어를 직접 선택하고 실행할 1인 또는 소규모 팀',
      defaultScope: '즉시 실행 가능하고 대규모 자원이 불필요한 안으로 한정하라.',
      principles: [
        '단순 나열이 아닌, 각 안의 차별점이 드러나도록 구성하라',
        '선택을 돕기 위해 비교 기준(비용, 난이도, 임팩트)을 명시하라',
        '추상적 수식어 대신 구체적 특징으로 설명하라',
      ],
      exclusions: ['실현 불가능하거나 대규모 자원이 필요한 안을 포함하지 마라'],
    },
    writing: {
      role: '실무 문서 작성에 능한 전문 에디터',
      verbs: ['문서의 목적과 핵심 메시지를 정의하라', '독자 관점에서 논리 흐름을 설계하라', '각 섹션에 들어갈 핵심 내용을 구성하라', '수치·일정·담당자 등 구체 정보가 들어갈 자리를 표기하라'],
      defaultPurpose: '독자가 핵심 내용을 빠르게 파악하고 후속 행동을 취할 수 있도록 하는 것',
      defaultAudience: '해당 문서를 검토하거나 승인할 실무 담당자',
      defaultScope: '핵심 목적에 직접 관련된 내용만 포함하라.',
      principles: [
        '각 섹션이 독립적으로 읽혀도 의미가 통하게 작성하라',
        '결론이나 요청 사항을 문서 앞부분에 먼저 제시하라',
        '구체 정보가 빈 곳은 [여기에 ○○ 입력] 형태로 플레이스홀더를 넣어라',
      ],
      exclusions: [],
    },
    content: {
      role: '플랫폼 특성을 이해하는 콘텐츠 전략가',
      verbs: ['타깃 오디언스와 핵심 메시지를 정의하라', '플랫폼에 맞는 포맷과 톤을 제안하라', '차별화 포인트와 구체적 훅(첫 문장/첫 3초)을 제시하라', '실행 가능한 콘텐츠 후보를 우선순위와 함께 나열하라'],
      defaultPurpose: '타깃 오디언스에게 도달하고 반응(참여/전환)을 이끌어내는 것',
      defaultAudience: '직접 콘텐츠를 기획하고 제작할 1인 크리에이터 또는 소규모 팀',
      defaultScope: '단일 캠페인 또는 단일 주제 단위로 한정하라.',
      principles: [
        '각 콘텐츠 안에는 구체적인 훅(첫 문장/첫 3초) 제안을 포함하라',
        '"좋은 콘텐츠"가 아니라, 어떤 반응을 유도할 것인지 행동 목표를 명시하라',
        '제작 난이도(촬영 필요, 텍스트만, 디자인 필요 등)를 표기하라',
      ],
      exclusions: ['플랫폼 특성과 무관한 범용 조언을 나열하지 마라'],
    },
    dev: {
      role: '요구사항을 실행 가능한 단위로 분해하는 기술 기획자',
      verbs: ['핵심 기능 요구사항을 정의하라', '구현 범위를 MVP 기준으로 분해하라', '기술 스택 선택의 근거를 제시하라', '완료 기준과 제외 항목을 명시하라'],
      defaultPurpose: '아이디어를 즉시 실행 가능한 기술 명세로 전환하는 것',
      defaultAudience: '직접 구현하거나 외주를 의뢰할 개발 실무자',
      defaultScope: '1차 MVP 범위로 한정하라.',
      principles: [
        '각 기능은 "사용자가 ~할 수 있다" 형태의 완결된 요구사항으로 기술하라',
        '기술 선택은 소규모 팀 기준으로 진입장벽이 낮은 옵션을 우선하라',
        '비용이 발생하는 항목(서버, 도메인, API)은 별도로 표기하라',
      ],
      exclusions: ['MVP 범위를 넘어서는 기능을 본문에 포함하지 마라'],
    },
    compare: {
      role: '공정한 비교 분석과 의사결정 지원에 능한 평가 전문가',
      verbs: ['비교 대상의 핵심 특성을 동일 기준으로 정리하라', '장단점을 균형 있게 대조하라', '상황별 적합도를 평가하라', '최종 추천안과 선택 근거를 제시하라'],
      defaultPurpose: '비교 대상 간의 차이를 명확히 이해하고 최적 선택을 돕는 것',
      defaultAudience: '직접 선택해야 하는 실무자 또는 의사결정자',
      defaultScope: '핵심 비교 대상 2~4개로 한정하라.',
      principles: [
        '비교 축을 먼저 정의하고, 모든 항목에 동일 축을 적용하라',
        '한쪽에 편향되지 않도록 장단점을 균형 있게 제시하라',
        '사용 맥락에 따라 달라질 수 있는 부분은 조건부 추천으로 표현하라',
      ],
      exclusions: ['단순 사양 나열로 끝내지 마라. 반드시 판단 근거를 포함하라'],
    },
    learning: {
      role: '복잡한 개념을 단계적으로 전달하는 교육 전문가',
      verbs: ['핵심 개념을 명확히 정의하라', '단계적으로 설명하라', '구체적 예시를 포함하라', '흔한 오해나 주의사항을 짚어라'],
      defaultPurpose: '개념을 정확히 이해하고 실무나 후속 학습에 활용할 수 있도록 하는 것',
      defaultAudience: '해당 주제를 처음 접하거나 기초를 다지려는 학습자',
      defaultScope: '핵심 개념 이해에 필요한 범위로 한정하라.',
      principles: [
        '전문 용어를 처음 사용할 때는 쉬운 비유와 함께 설명하라',
        '추상적 설명 뒤에는 반드시 구체적 예시를 제시하라',
        '선행 지식이 필요한 경우 명시하라',
      ],
      exclusions: ['학술 논문 스타일의 난해한 서술을 지양하라'],
    },
    decision: {
      role: '실행 중심의 전략 기획 및 의사결정 전문가',
      verbs: ['현황과 목표 사이의 갭을 정의하라', '실행 가능한 전략 옵션 2~3개를 도출하라', '각 옵션의 리스크·비용·기대효과를 평가하라', '추천안과 즉시 실행 항목을 제시하라'],
      defaultPurpose: '현실적으로 실행 가능한 방향을 수립하고 첫 실행 단계를 도출하는 것',
      defaultAudience: '직접 실행하거나 의사결정에 참여하는 실무 기획자',
      defaultScope: '6개월 이내 실행 가능한 범위로 한정하라.',
      principles: [
        '전략은 "무엇을 하지 않을 것인가"도 포함하라',
        '각 옵션에 필요 자원(시간, 비용, 인력)을 명시하라',
        '추천안에는 첫 2주 이내 시작할 수 있는 구체적 행동 1~2개를 포함하라',
      ],
      exclusions: [],
    },
  };

  const TASK_CONFIG_EN = {
    research: {
      role: 'a market research specialist skilled in competitive landscape analysis',
      verbs: ['Survey the current state of the subject', 'Compare and analyze the competitive landscape using consistent axes', 'Present key metrics with supporting evidence', 'Derive risks and actionable implications'],
      defaultPurpose: 'to gather evidence-based insights that support informed decision-making',
      defaultAudience: 'a business decision-maker or planning lead',
      defaultScope: 'Limit to the top 3-5 most relevant items.',
      principles: ['Support every claim with data, metrics, or source-based evidence', 'Apply consistent comparison axes (cost, scale, growth potential, etc.)', 'Clearly distinguish facts from inferences'],
      exclusions: ['Do not state unsourced figures as confirmed facts'],
    },
    ideation: {
      role: 'a creative strategist who generates structured, actionable options',
      verbs: ['Propose differentiated candidates', 'Explain each option\'s key trait and rationale', 'Compare execution difficulty and expected impact', 'Identify the top-priority option to start immediately'],
      defaultPurpose: 'to produce a shortlist of viable options and select the best fit',
      defaultAudience: 'an individual or small team who will select and execute the idea',
      defaultScope: 'Limit to realistic, immediately implementable ideas.',
      principles: ['Show clear differentiation between options, not just a flat list', 'Include comparison criteria (cost, difficulty, impact) to aid selection', 'Replace vague adjectives with concrete characteristics'],
      exclusions: ['Do not include impractical ideas requiring large-scale resources'],
    },
    writing: {
      role: 'a professional editor specialized in business documentation',
      verbs: ['Define the document\'s purpose and core message', 'Design the logical flow from the reader\'s perspective', 'Compose key content for each section', 'Mark placeholders for specific data (metrics, dates, owners)'],
      defaultPurpose: 'to enable the reader to quickly grasp key points and take follow-up action',
      defaultAudience: 'the reviewer or approver of this document',
      defaultScope: 'Include only content directly related to the core purpose.',
      principles: ['Each section should be independently readable and meaningful', 'Lead with the conclusion or ask before the supporting detail', 'Use [insert ○○ here] placeholders for missing specifics'],
      exclusions: [],
    },
    content: {
      role: 'a content strategist who understands platform-specific dynamics',
      verbs: ['Define the target audience and core message', 'Propose platform-appropriate formats and tone', 'Present differentiation points with specific hooks (opening line / first 3 seconds)', 'List actionable content ideas ranked by priority'],
      defaultPurpose: 'to reach the target audience and drive engagement or conversion',
      defaultAudience: 'a solo creator or small team who will plan and produce the content',
      defaultScope: 'Focus on a single campaign or single topic.',
      principles: ['Each content idea must include a specific hook (opening line / first 3 seconds)', 'Define the behavioral goal (what reaction to drive), not just "good content"', 'Tag production difficulty (text-only, needs photography, needs design, etc.)'],
      exclusions: ['Do not list generic advice unrelated to the specific platform'],
    },
    dev: {
      role: 'a technical planner who breaks requirements into implementable units',
      verbs: ['Define core functional requirements', 'Decompose the build scope into MVP phases', 'Justify technology choices', 'Specify completion criteria and exclusions'],
      defaultPurpose: 'to convert an idea into an immediately actionable technical specification',
      defaultAudience: 'a developer or technical lead who will implement or commission the work',
      defaultScope: 'Limit to MVP scope.',
      principles: ['Write each feature as a complete user story: "User can [action]"', 'Prefer low-barrier tech options suitable for solo developers or small teams', 'Flag any cost-incurring items (hosting, domains, paid APIs) separately'],
      exclusions: ['Do not include features beyond MVP scope in the main body'],
    },
    compare: {
      role: 'an impartial evaluation specialist supporting informed decision-making',
      verbs: ['Organize key characteristics of each option using consistent criteria', 'Present balanced pros and cons', 'Evaluate fit based on different use-case scenarios', 'Provide a final recommendation with clear rationale'],
      defaultPurpose: 'to clarify differences between options and support optimal selection',
      defaultAudience: 'a practitioner or decision-maker who needs to choose',
      defaultScope: 'Limit to 2-4 core comparison targets.',
      principles: ['Define comparison axes first, then apply them uniformly', 'Present pros and cons in a balanced manner without bias', 'Use conditional recommendations where context matters'],
      exclusions: ['Do not end with a mere spec list. Always include judgment rationale.'],
    },
    learning: {
      role: 'an expert educator who breaks down complex ideas step by step',
      verbs: ['Define the core concept clearly', 'Explain step by step', 'Include concrete examples', 'Address common misconceptions and caveats'],
      defaultPurpose: 'to build accurate understanding for practical application or further learning',
      defaultAudience: 'a learner encountering this topic for the first time or solidifying fundamentals',
      defaultScope: 'Limit to what is needed for foundational understanding.',
      principles: ['When introducing a technical term, pair it with a simple analogy', 'Follow every abstract explanation with a concrete example', 'State prerequisite knowledge when applicable'],
      exclusions: ['Avoid dense academic prose that obscures rather than clarifies'],
    },
    decision: {
      role: 'an execution-focused strategic planning consultant',
      verbs: ['Define the gap between current state and target goal', 'Derive 2-3 actionable strategic options', 'Evaluate risks, costs, and expected impact for each option', 'Present the recommended option with immediate action items'],
      defaultPurpose: 'to establish a realistic strategic direction and identify the first concrete action step',
      defaultAudience: 'a hands-on planner or decision-maker involved in execution',
      defaultScope: 'Limit to what is executable within 6 months.',
      principles: ['Strategy must include what NOT to do, not just what to do', 'Specify required resources (time, cost, personnel) for each option', 'Include 1-2 concrete actions that can start within the first two weeks'],
      exclusions: [],
    },
  };

  // ═══════════════════════════════════════════
  // 11. 프롬프트 합성 — 산출물 유형 + 작업 범주 조합
  //     보정 강도(intensity)에 따라 블록 밀도 조절
  // ═══════════════════════════════════════════

  function synthesize(text, lang, outputType, task, intensity, safetyResult) {
    const subject = extractSubject(text, lang);
    const userCtx = extractContext(text, lang);
    const gaps = analyzeGaps(text, lang, task);
    const cfg = (lang === 'ko' ? TASK_CONFIG_KO : TASK_CONFIG_EN)[task];
    const topic = subject || (lang === 'ko' ? '요청된 주제' : 'the requested topic');

    return lang === 'ko'
      ? buildKo(topic, cfg, gaps, task, outputType, intensity, userCtx, safetyResult)
      : buildEn(topic, cfg, gaps, task, outputType, intensity, userCtx, safetyResult);
  }

  // ── 한국어 합성 ──
  function buildKo(topic, cfg, gaps, task, outputType, intensity, userCtx, safety) {
    const L = [];
    const v = (pool) => pickVar(pool, outputType, intensity);

    // ── 블록 1: 역할 ──
    L.push(`[역할]`);
    L.push(`너는 ${cfg.role}로서 응답하라.`);

    // ── 블록 2: 작업 목표 ──
    L.push('');
    L.push(`[작업 목표]`);
    let enrichedTopic = topic;
    if (userCtx.region) enrichedTopic += ` (지역: ${userCtx.region})`;
    if (userCtx.business) enrichedTopic += ` (업종: ${userCtx.business})`;
    if (userCtx.priceAnalysis) enrichedTopic += ` — 가격/비용 비교 포함`;
    L.push(`"${enrichedTopic}"에 대해 다음을 수행하라.`);
    for (const verb of cfg.verbs) L.push(`- ${verb}`);

    // ── 블록 3: 맥락 보정 — 강도별 조절 ──
    const corrections = [];

    // aggressive (strong + moderate)
    if (intensity === 'strong' || intensity === 'moderate') {
      if (gaps.purposeMissing) corrections.push(`- 이 작업의 목적: ${cfg.defaultPurpose}`);
      if (gaps.scopeMissing) corrections.push(`- 범위 기준: ${cfg.defaultScope}`);
    }
    // aggressive (strong only)
    if (intensity === 'strong') {
      if (gaps.constraintsMissing) corrections.push(`- 기본 제약: 1인 또는 소규모 팀 기준, 과도한 예산 없이 즉시 실행 가능한 범위를 우선하라.`);
    }
    // cautious (strong only)
    if (intensity === 'strong') {
      if (gaps.audienceMissing) corrections.push(`- 예상 독자: ${cfg.defaultAudience}`);
    }

    // aggressive — 판단 기준 보정
    if (gaps.criteriaMissing) corrections.push(`- 판단 기준: 주관적 표현("좋은/추천/괜찮은") 대신, 비용·난이도·소요 시간·초보자 적합성 중 적절한 축으로 평가하라.`);

    // 작업별 추가 보정 (forbidden 항목 제외: 지역, 플랫폼, 고객군, 업종, 기간, 예산은 자동보정 금지)
    if (gaps.needsRecency) corrections.push(`- 최신성: 가능한 한 최근 1년 이내 정보를 기준으로 작성하라. 시점이 중요한 수치는 기준 연도를 명시하라.`);
    if (task === 'research' && gaps.compAxisMissing) corrections.push(`- 비교 축: 가격, 품질, 접근성, 시장점유율 중 적합한 축을 선택하여 비교하라.`);
    if (task === 'content' && gaps.toneMissing) corrections.push(`- 톤/분위기: 타깃 독자층에 맞는 톤을 추론하여 적용하라.`);
    if (task === 'dev') {
      if (gaps.featuresMissing) corrections.push(`- 핵심 기능: 해당 유형의 일반적 핵심 기능 3~5개를 기본으로 정의하라.`);
      if (gaps.techStackMissing) corrections.push(`- 기술 스택: 소규모 팀 기준으로 진입장벽이 낮은 기술을 추천하라.`);
      if (gaps.mvpMissing) corrections.push(`- MVP 기준: 최소 기능 제품 범위로 한정하고, 부가 기능은 "향후 확장"으로 분리하라.`);
    }
    if (task === 'writing') {
      if (gaps.lengthMissing) corrections.push(`- 분량: A4 1~2장 분량의 실무 문서 수준으로 한정하라.`);
      if (gaps.toneMissing) corrections.push(`- 톤: 비즈니스 공식 문서에 적합한 격식체를 사용하라.`);
    }
    if (task === 'ideation') {
      if (gaps.countMissing) corrections.push(`- 후보 개수: 3~5개를 제시하라.`);
      if (gaps.feasibilityMissing) corrections.push(`- 실행 가능성: 바로 시작할 수 있는 현실적 안을 우선하라.`);
    }
    if (task === 'compare') {
      if (gaps.axisMissing) corrections.push(`- 비교 축: 가격, 성능, 난이도, 유지보수, 초보자 적합성 중 적절한 축을 선택하여 적용하라.`);
      if (gaps.conclusionMissing) corrections.push(`- 결론: 단순 나열로 끝내지 말고, 상황별 추천과 최종 판단을 포함하라.`);
    }
    if (task === 'learning') {
      if (gaps.levelMissing) corrections.push(`- 난이도: 해당 주제를 처음 접하는 학습자 수준으로 설명하라.`);
      if (gaps.exampleMissing) corrections.push(`- 예시: 추상적 설명 뒤에는 반드시 구체적 예시 1개 이상을 포함하라.`);
    }
    if (task === 'decision' && gaps.timeframeMissing) {
      corrections.push(`- 시간 범위: 3~6개월 이내 실행 가능한 범위로 한정하라.`);
    }

    if (corrections.length > 0) {
      L.push('');
      L.push(`[맥락 보정]`);
      L.push(`아래 조건은 입력에서 명시되지 않았으므로 보수적 기본값으로 적용한다.`);
      for (const c of corrections) L.push(c);
    }

    // ── 블록 4: 처리 원칙 ──
    L.push('');
    L.push(`[처리 원칙]`);
    for (const p of cfg.principles) L.push(`- ${p}`);
    if (intensity === 'strong') {
      L.push(`- ${v(VAR_KO.real_action)}`);
      L.push(`- ${v(VAR_KO.real_priority)}`);
    }

    // ── 블록 5: 제외 조건 ──
    L.push('');
    L.push(`[제외 조건]`);
    L.push(`- ${v(VAR_KO.excl_filler)}`);
    L.push(`- ${v(VAR_KO.excl_fabricate)}`);
    L.push(`- ${v(VAR_KO.excl_padding)}`);
    for (const ex of cfg.exclusions) L.push(`- ${ex}`);

    // ── 블록 6: 출력 형식 (산출물 유형 기반) ──
    L.push('');
    L.push(`[출력 형식]`);
    L.push(OUTPUT_FORMAT_KO[outputType]);
    if (task === 'research' && (userCtx.business || userCtx.region || userCtx.priceAnalysis)) {
      L.push(`상권/업종/지역/가격 비교 축을 별도 섹션으로 포함하라.`);
    }
    if (intensity !== 'light') {
      L.push(`각 섹션은 소제목으로 구분하고, 항목이 3개 이상이면 번호 또는 불릿으로 나열하라.`);
    }

    // ── 블록 7: 불확실성 처리 ──
    if (intensity !== 'light') {
      L.push('');
      L.push(`[불확실성 처리]`);
      L.push(`- ${v(VAR_KO.unc_limit)}`);
      L.push(`- ${v(VAR_KO.unc_flag)}`);
      if (intensity === 'strong') {
        L.push(`- 입력이 모호한 부분은 가장 일반적인 해석 하나를 선택하되 그 선택을 밝혀라`);
      }
    }

    // ── 주의 등급 면책 안내 ──
    if (safety && safety.level === 'caution') {
      L.push('');
      L.push(`[주의]`);
      L.push(`이 주제(${safety.category})는 전문가 자문이 필요한 민감 영역이다. 확정적 자문이 아닌 일반 정보 정리 수준으로 응답하라. 구체적 판단이 필요한 부분은 "전문가 상담을 권장합니다"로 안내하라.`);
    }

    return L.join('\n');
  }

  // ── 영어 합성 ──
  function buildEn(topic, cfg, gaps, task, outputType, intensity, userCtx, safety) {
    const L = [];
    const v = (pool) => pickVar(pool, outputType, intensity);

    // ── Block 1: Role ──
    L.push(`[Role]`);
    L.push(`Respond as ${cfg.role}.`);

    // ── Block 2: Objective ──
    L.push('');
    L.push(`[Objective]`);
    let enrichedTopic = topic;
    if (userCtx.region) enrichedTopic += ` (region: ${userCtx.region})`;
    if (userCtx.business) enrichedTopic += ` (industry: ${userCtx.business})`;
    if (userCtx.priceAnalysis) enrichedTopic += ` — include pricing/cost comparison`;
    L.push(`Regarding "${enrichedTopic}", perform the following.`);
    for (const verb of cfg.verbs) L.push(`- ${verb}`);

    // ── Block 3: Context Correction ──
    const corrections = [];

    if (intensity === 'strong' || intensity === 'moderate') {
      if (gaps.purposeMissing) corrections.push(`- Purpose: ${cfg.defaultPurpose}`);
      if (gaps.scopeMissing) corrections.push(`- Scope: ${cfg.defaultScope}`);
    }
    if (intensity === 'strong') {
      if (gaps.constraintsMissing) corrections.push(`- Constraints: Assume a solo operator or small team, no large budget, prioritize immediately actionable options.`);
      if (gaps.audienceMissing) corrections.push(`- Audience: ${cfg.defaultAudience}`);
    }
    if (gaps.criteriaMissing) corrections.push(`- Criteria: Replace subjective terms ("good"/"best") with axes such as cost, difficulty, time, beginner-friendliness.`);
    if (gaps.needsRecency) corrections.push(`- Recency: Use information from the past year. Cite reference years for time-sensitive data.`);

    if (task === 'research' && gaps.compAxisMissing) corrections.push(`- Comparison axes: Select from price, quality, accessibility, market share.`);
    if (task === 'content' && gaps.toneMissing) corrections.push(`- Tone: Infer appropriate tone from the target audience.`);
    if (task === 'dev') {
      if (gaps.featuresMissing) corrections.push(`- Features: Define 3-5 typical core features for this type of product.`);
      if (gaps.techStackMissing) corrections.push(`- Tech stack: Recommend beginner-friendly, low-barrier options.`);
      if (gaps.mvpMissing) corrections.push(`- MVP: Limit to minimum viable product scope. Separate extras into "Future enhancements".`);
    }
    if (task === 'writing') {
      if (gaps.lengthMissing) corrections.push(`- Length: Limit to 1-2 page business document.`);
      if (gaps.toneMissing) corrections.push(`- Tone: Use formal business writing.`);
    }
    if (task === 'ideation') {
      if (gaps.countMissing) corrections.push(`- Count: Present 3-5 candidates.`);
      if (gaps.feasibilityMissing) corrections.push(`- Feasibility: Prioritize immediately actionable, realistic options.`);
    }
    if (task === 'compare') {
      if (gaps.axisMissing) corrections.push(`- Comparison axes: Select from price, performance, difficulty, maintainability, beginner-friendliness.`);
      if (gaps.conclusionMissing) corrections.push(`- Conclusion: Do not end with a list. Include scenario-based recommendations and a final judgment.`);
    }
    if (task === 'learning') {
      if (gaps.levelMissing) corrections.push(`- Level: Default to beginner/foundational.`);
      if (gaps.exampleMissing) corrections.push(`- Examples: Include at least one concrete example after each abstract explanation.`);
    }
    if (task === 'decision' && gaps.timeframeMissing) {
      corrections.push(`- Timeframe: Limit to 3-6 month execution window.`);
    }

    if (corrections.length > 0) {
      L.push('');
      L.push(`[Context Correction]`);
      L.push(`The following defaults apply because they were not specified in the input.`);
      for (const c of corrections) L.push(c);
    }

    // ── Block 4: Principles ──
    L.push('');
    L.push(`[Principles]`);
    for (const p of cfg.principles) L.push(`- ${p}`);
    if (intensity === 'strong') {
      L.push(`- ${v(VAR_EN.real_action)}`);
      L.push(`- ${v(VAR_EN.real_priority)}`);
    }

    // ── Block 5: Exclusions ──
    L.push('');
    L.push(`[Exclusions]`);
    L.push(`- ${v(VAR_EN.excl_filler)}`);
    L.push(`- ${v(VAR_EN.excl_fabricate)}`);
    L.push(`- ${v(VAR_EN.excl_padding)}`);
    for (const ex of cfg.exclusions) L.push(`- ${ex}`);

    // ── Block 6: Output Format (output-type driven) ──
    L.push('');
    L.push(`[Output Format]`);
    L.push(OUTPUT_FORMAT_EN[outputType]);
    if (task === 'research' && (userCtx.business || userCtx.region || userCtx.priceAnalysis)) {
      L.push(`Include a dedicated section for local market/industry/region/pricing comparison axes.`);
    }
    if (intensity !== 'light') {
      L.push(`Separate each section with a subheading. Use numbered or bulleted lists for 3+ items.`);
    }

    // ── Block 7: Uncertainty Handling ──
    if (intensity !== 'light') {
      L.push('');
      L.push(`[Uncertainty Handling]`);
      L.push(`- ${v(VAR_EN.unc_limit)}`);
      L.push(`- ${v(VAR_EN.unc_flag)}`);
      if (intensity === 'strong') {
        L.push(`- If ambiguous, choose the most common interpretation and state that choice`);
      }
    }

    // ── Caution disclaimer ──
    if (safety && safety.level === 'caution') {
      L.push('');
      L.push(`[Caution]`);
      L.push(`This topic (${safety.category}) is a sensitive area requiring professional advice. Respond with general information only, not definitive counsel. For specific decisions, advise: "Consult a qualified professional."`);
    }

    return L.join('\n');
  }

  // ═══════════════════════════════════════════
  // 12. 결과 후검사 (Post-check)
  // ═══════════════════════════════════════════

  const POST_CHECK_PATTERNS = [
    /방법을?\s*(?:알려|설명|제시)/,
    /제조\s*(?:방법|과정|순서)/,
    /실행\s*(?:계획|단계|방법)/,
    /how to (?:make|build|create|synthesize|cook)\s+(?:bomb|weapon|drug|poison|explosive)/i,
    /step.by.step.*(?:attack|hack|exploit|forge)/i,
  ];

  function postCheck(result) {
    const lower = result.toLowerCase();
    const dangerList = [
      '폭탄 제조', '약물 합성', '해킹 방법', '자살 방법', '살인 방법', '계정 뚫', '위치 추적 방법',
      'bomb making', 'drug synthesis', 'how to hack', 'suicide method', 'how to kill', 'crack account', 'track location',
    ];
    for (const d of dangerList) {
      if (lower.includes(d.toLowerCase())) return false;
    }
    for (const p of POST_CHECK_PATTERNS) {
      if (p.test(result)) {
        const dangerNouns = ['폭탄', '무기', '독극물', '약물', '마약', '계정', 'bomb', 'weapon', 'poison', 'drug', 'account'];
        if (dangerNouns.some(n => lower.includes(n))) return false;
      }
    }
    return true;
  }

  // ═══════════════════════════════════════════
  // 13. 메인 정제 함수
  // ═══════════════════════════════════════════

  function refine(input) {
    const text = (input || '').trim();

    if (!text) {
      return { error: true, message: '입력이 비어 있습니다. 정제할 텍스트를 입력해 주세요.' };
    }

    const lang = detectLang(text);

    if (text.length < 3) {
      const msg = lang === 'ko'
        ? '입력이 너무 짧습니다. 원하는 작업을 조금 더 구체적으로 설명해 주세요.'
        : 'Input is too short. Please describe what you want in more detail.';
      return { error: true, message: msg };
    }

    // [1] 안전 판정
    const safety = assessSafety(text, lang);
    if (safety.level === 'block') {
      const msg = lang === 'ko'
        ? '이 요청은 불법적이거나 타인에게 위해를 가할 수 있어 정제할 수 없습니다.\n안전하고 합법적인 범위의 요청만 지원합니다.'
        : 'This request may involve illegal activity or potential harm and cannot be refined.\nOnly safe and lawful requests are supported.';
      return { error: true, blocked: true, message: msg };
    }

    // [2] 입력 품질 측정
    const quality = measureInputQuality(text, lang);

    // [3] 산출물 유형 + 작업 범주 라우팅 (v4 핵심)
    const { outputType, task } = route(text, lang);

    // [4] 합성
    const result = synthesize(text, lang, outputType, task, quality.intensity, safety);

    // [5] 후검사
    if (!postCheck(result)) {
      const msg = lang === 'ko'
        ? '생성된 프롬프트가 안전 기준을 충족하지 못해 출력할 수 없습니다.\n요청 내용을 안전한 범위로 수정하여 다시 시도해 주세요.'
        : 'The generated prompt did not pass safety review and cannot be displayed.\nPlease revise your request within safe boundaries and try again.';
      return { error: true, blocked: true, message: msg };
    }

    return {
      error: false,
      lang,
      outputType,
      task,
      intensity: quality.intensity,
      qualityScore: quality.score,
      safety: safety.level,
      result,
    };
  }

  return { refine, detectLang };
})();
