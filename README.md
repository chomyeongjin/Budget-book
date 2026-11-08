# 📒 Budget Book — 사진 달력 가계부

큰 배경 사진 위에 달력이 올라가는 가계부 웹앱입니다.
화면은 **GitHub Pages**, 로그인과 데이터 저장은 **Supabase**를 사용합니다. 서버를 따로 실행할 필요가 없고, 맥북·아이폰 어디서든 접속할 수 있습니다.

## 기능

- 🗓 **캘린더 형식**: 월요일부터 시작하는 달력에 날짜마다 수입/지출 합계를 표시합니다.
- 📊 **요약**: 선택한 날과 이번 달 각각의 *카테고리별 합산액, 총 지출, 총 수입, 합계*를 보여 줍니다.
- ✍️ **매일 기록**: 날짜를 눌러 지출이나 수입을 추가하고, 수정·삭제할 수 있습니다.
- 🏷 **카테고리 설정**: 이름, 색상, 지출/수입 구분을 직접 추가·수정·삭제합니다.
- 🖼 **배경 사진**: 기본 사진을 정하거나, 달마다 다른 사진을 넣을 수 있습니다.
- 🔴 **하루 지출 10만원 이상**인 날은 빨간색으로 표시합니다.
- 🔐 **이메일 로그인과 회원가입**: 각자 자기 데이터만 볼 수 있습니다(Supabase 행 단위 보안).
- 📄 모든 기능이 **한 페이지**에서 동작합니다.

## 처음 한 번만 하는 설정

### 1. Supabase 데이터베이스 만들기
1. Supabase 대시보드에서 프로젝트를 엽니다.
2. 왼쪽 메뉴의 **SQL Editor** → **New query**로 들어갑니다.
3. [`supabase/schema.sql`](supabase/schema.sql) 내용을 전부 붙여넣고 **Run**을 누릅니다.
   - 테이블, 보안 규칙, 기본 카테고리, 배경 사진 저장소가 한 번에 만들어집니다.

### 2. 로그인 주소 설정 (Authentication → URL Configuration)
- **Site URL**: `https://chomyeongjin.github.io/Budget-book/`
- **Redirect URLs**에도 같은 주소를 추가합니다.
- 가입 확인 메일의 링크를 누르면 이 주소로 돌아옵니다.

> 선택 사항
> - 확인 메일 없이 바로 가입되게 하려면 **Authentication → Sign In / Providers → Email**에서 *Confirm email*을 끄면 됩니다.
> - 본인 계정을 만든 뒤 다른 사람이 가입하지 못하게 하려면 *Allow new users to sign up*을 끄면 됩니다.

### 3. GitHub Pages 켜기
1. 이 코드를 `main` 브랜치에 합칩니다.
2. GitHub 레포의 **Settings → Pages**에서 *Source*를 **Deploy from a branch**로, 브랜치를 **main / (root)**로 선택하고 저장합니다.
3. 1~2분 뒤 `https://chomyeongjin.github.io/Budget-book/`로 접속합니다.

## 파일 구조

```
index.html             # 화면
style.css              # 디자인
app.js                 # 달력, 요약, 기록, 카테고리, 배경 로직 (Supabase 연동)
config.js              # Supabase 주소와 공개용(publishable) 키
vendor/                # Supabase JS 라이브러리 (v2.118.0, MIT)
supabase/schema.sql    # 데이터베이스 설정 SQL
```

> `config.js`에는 공개용 키만 넣습니다. **`sb_secret_...` 비밀 키는 절대 넣지 마세요.**

## 맥에서 바로 열어 보기 (선택)

```bash
python3 -m http.server 8000
```

그다음 http://localhost:8000 으로 접속합니다. 이 경우에는 Supabase의 Redirect URLs에 `http://localhost:8000/`도 추가해 주세요.
