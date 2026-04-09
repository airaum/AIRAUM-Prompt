# GitHub Pages 배포 가이드

GitHub를 처음 사용하는 분을 위한 단계별 안내입니다.  
이 가이드를 따라하면, 누구나 링크를 클릭해서 AIRAUM Prompt Refiner를 사용할 수 있는 실제 사이트가 만들어집니다.

비용은 0원입니다. 도메인 구매도 필요 없습니다.

---

## 배포하면 무엇을 얻나요?

| 구분 | 링크 형태 | 용도 |
|------|-----------|------|
| **GitHub 저장소** | `github.com/내아이디/AIRAUM-Prompt-Refiner` | 소스코드를 보는 곳 (개발자용) |
| **공개 사이트** | `내아이디.github.io/AIRAUM-Prompt-Refiner/` | 실제 사용하는 곳 (누구나) |

인스타그램, 쓰레드, 카카오톡 등에 공유할 링크는 **공개 사이트 링크**입니다.

---

## 준비물

- GitHub 계정 (없으면 [github.com](https://github.com)에서 무료 가입)
- 이 프로젝트의 파일들

---

## 방법 A: GitHub 웹사이트에서 직접 올리기 (가장 쉬움)

### 1단계: 새 저장소 만들기

1. [github.com](https://github.com)에 로그인합니다.
2. 오른쪽 위 **+** 버튼 → **New repository** 클릭
3. 아래처럼 입력합니다:
   - **Repository name**: `AIRAUM-Prompt-Refiner`
   - **Description**: `한국어·영어 프롬프트 정제 도구` (선택)
   - **Public** 선택 (반드시 Public이어야 무료 Pages 사용 가능)
   - **Add a README file**: 체크 해제
4. **Create repository** 클릭

### 2단계: 파일 올리기

1. 만들어진 저장소 페이지에서 **uploading an existing file** 링크를 클릭합니다.
   - 또는 **Add file** → **Upload files** 클릭
2. 컴퓨터에서 아래 파일/폴더를 모두 선택해서 드래그합니다:
   - `index.html`
   - `css/` 폴더 (style.css 포함)
   - `js/` 폴더 (refiner.js, app.js 포함)
   - `notes/` 폴더
   - `README.md`
   - `LICENSE`
3. 아래쪽 **Commit changes** 버튼 클릭

### 3단계: GitHub Pages 켜기

1. 저장소 상단 탭에서 **Settings** 클릭
2. 왼쪽 메뉴에서 **Pages** 클릭
3. **Source** 항목에서:
   - **Deploy from a branch** 선택
4. **Branch** 항목에서:
   - `main` 선택
   - 폴더는 `/ (root)` 유지
5. **Save** 클릭

### 4단계: 사이트 확인하기

1. Save를 누른 후 **1~3분** 기다립니다.
2. Settings → Pages 페이지를 새로고침합니다.
3. 상단에 초록색 박스로 사이트 주소가 표시됩니다:
   ```
   Your site is live at https://내아이디.github.io/AIRAUM-Prompt-Refiner/
   ```
4. 이 링크를 클릭하면 실제 사이트가 열립니다.

---

## 방법 B: Git 명령어로 올리기 (개발자용)

```bash
# 1. 프로젝트 폴더에서 Git 초기화
cd "AIRAUM Prompt Refiner"
git init
git add .
git commit -m "Initial commit"

# 2. GitHub 저장소 연결 및 푸시
git remote add origin https://github.com/내아이디/AIRAUM-Prompt-Refiner.git
git branch -M main
git push -u origin main
```

이후 **3단계: GitHub Pages 켜기**부터 동일하게 진행합니다.

---

## 배포 후 인스타그램/쓰레드에 링크 넣기

1. 인스타그램 → 프로필 편집 → 웹사이트 필드에 아래 주소 입력:
   ```
   https://내아이디.github.io/AIRAUM-Prompt-Refiner/
   ```
2. 쓰레드 → 게시물 작성 시 위 링크를 본문에 붙여넣기

이 주소가 바로 **다른 사람이 클릭하면 도구를 사용할 수 있는 실제 사이트 링크**입니다.

---

## 사이트가 안 뜰 때 체크리스트

| 증상 | 원인 | 해결 |
|------|------|------|
| 404 페이지가 뜸 | Pages가 아직 활성화 안 됨 | Settings → Pages에서 branch가 `main`으로 설정되어 있는지 확인. 3분 더 기다리기 |
| 빈 페이지가 뜸 | `index.html`이 저장소 루트에 없음 | 파일 목록에서 `index.html`이 최상위에 있는지 확인 (폴더 안에 들어가 있으면 안 됨) |
| CSS가 안 먹힘 | 폴더 구조가 깨짐 | `css/style.css` 경로가 유지되어야 함. css 폴더째로 올렸는지 확인 |
| 저장소가 Private임 | Private 저장소는 무료 Pages 불가 | Settings → General에서 Public으로 변경 |
| 수정했는데 반영이 안 됨 | GitHub Pages 캐시 | 1~2분 기다린 후 Ctrl+Shift+R(강력 새로고침) |

---

## 두 링크의 차이

- **`github.com/내아이디/AIRAUM-Prompt-Refiner`**  
  → 소스코드가 보이는 페이지. 개발자가 코드를 보거나 기여할 때 사용.

- **`내아이디.github.io/AIRAUM-Prompt-Refiner/`**  
  → 실제 도구가 동작하는 사이트. 일반 사용자에게 공유할 링크.

**인스타/쓰레드/카카오톡에는 `.github.io` 링크를 넣으세요.**
