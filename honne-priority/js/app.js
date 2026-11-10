/*
 * 画面遷移・UI・保存・結果画像・共有
 * 状態 state = { v, screen, seed, profile, draft, answers }
 *   screen：'top' | 'profile' | 'quiz'
 *   name：ニックネーム（この端末にだけ保存。結果の見出し・画像・投稿文に使う）
 *   質問と結果は HonneEngine.run(state) が毎回 answers から作り直す。
 */
(function () {
  'use strict';

  var D = window.HONNE_DATA, E = window.HonneEngine, S = D.SETTINGS;
  var STORAGE_KEY = 'honne-priority:v4'; // 診断ロジックを変えたら番号を上げる
  var H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  var H2C_SRI = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';
  var HASHTAG = '#本音の優先順位診断';

  var app = document.getElementById('app');
  var progEl = document.getElementById('progress');
  var state = load() || fresh();
  var prevAnswer = null; // 「戻る」で戻った質問の、直前の回答（ハイライト用）

  // ---------------------------------------------------------------- 保存（localStorage が使えなくても動く）
  function fresh() {
    return { v: 3, screen: 'top', seed: newSeed(), name: '', profile: null, draft: {}, answers: [] };
  }
  function newSeed() { return Math.floor(Math.random() * 2147483647) + 1; }
  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 3 || !Array.isArray(s.answers)) return null;
      s.name = cleanName(s.name || '');
      if (!s.name && s.screen === 'quiz') s.screen = 'profile';
      if (s.profile && Object.keys(E.validateProfile(s.profile)).length) { s.profile = null; s.answers = []; s.screen = 'top'; }
      if (s.screen === 'quiz' && !s.profile) s.screen = 'top';
      s.draft = s.draft || {};
      return s;
    } catch (e) { return null; }
  }
  function save() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function clearSaved() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  // ---------------------------------------------------------------- 小道具
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // ニックネーム：改行・制御文字・書字方向の制御文字を除き、20文字まで
  var NAME_MAX = 20;
  function cleanName(s) {
    s = String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, NAME_MAX).join('');
  }
  function h(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function on(sel, ev, fn) {
    Array.prototype.forEach.call(app.querySelectorAll(sel), function (el) { el.addEventListener(ev, fn); });
  }
  function hasProgress() { return !!(state.profile && (state.answers.length || state.screen === 'quiz')); }
  function backButton() { return '<button type="button" class="btn ghost back" data-back>← 1つ戻る</button>'; }

  // ---------------------------------------------------------------- 進捗バー
  var STEPS = ['基本情報', '段階0', '段階1', '段階2', '段階3'];
  function renderProgress(p) {
    if (!p) { progEl.hidden = true; progEl.innerHTML = ''; return; }
    var cur = p.stage == null ? 0 : p.stage + 1;
    var pills = STEPS.map(function (s, i) {
      return '<span class="pill' + (i < cur ? ' done' : i === cur ? ' now' : '') + (i === 4 ? ' optional' : '') + '">' + s + '</span>';
    }).join('');
    var pct = p.total ? Math.round(p.index / p.total * 100) : 0;
    progEl.innerHTML =
      '<div class="pills">' + pills + '</div>' +
      '<div class="ptext"><span>' + esc(p.name) + '</span><span class="pcount">' + (p.total ? p.index + ' / ' + p.total + '問' : '') + '</span></div>' +
      '<div class="pbar"><span style="width:' + pct + '%"></span></div>';
    progEl.hidden = false;
  }

  // ---------------------------------------------------------------- 描画の入り口
  function render() {
    if (state.screen === 'profile') return renderProfile();
    if (state.screen === 'quiz' && state.profile) return renderQuiz();
    return renderTop();
  }

  // ---------------------------------------------------------------- トップ
  function renderTop() {
    renderProgress(null);
    var resume = hasProgress()
      ? '<div class="resume"><p><b>前回の続きがあります</b>（' + state.answers.length + '問回答済み）</p>' +
        '<div class="row"><button type="button" class="btn primary" data-resume>続きから再開</button>' +
        '<button type="button" class="btn" data-restart>最初から</button></div></div>'
      : '<button type="button" class="btn primary big" data-start>診断をはじめる</button>';
    h(
      '<section class="hero">' +
        '<p class="kicker">恋活・婚活の自己分析</p>' +
        '<h1>本音の<br>優先順位診断</h1>' +
        '<p class="lead">「年収と顔なら？」「趣味が合うのと性格が合うのなら？」——2択に答えていくと、相手に求める条件の<b>本当の優先順位</b>と<b>妥協できない条件TOP3</b>がわかります。</p>' +
        '<ul class="facts">' +
          '<li><span class="ic">⏱</span>所要時間 約10〜15分（約50問＋詳しく診断する場合は12問）</li>' +
          '<li><span class="ic">🔒</span>回答はどこにも送信されません（この端末の中だけで計算します）</li>' +
          '<li><span class="ic">📍</span>東京都内・近郊（神奈川・埼玉・千葉）在住の方を想定した診断です。年収などの数値は2026年の都内の水準で出題します</li>' +
        '</ul>' +
        resume +
      '</section>' +
      '<section class="how">' +
        '<h2>診断の流れ</h2>' +
        '<ol>' +
          '<li><b>基本情報</b>：年齢・身長・目的など</li>' +
          '<li><b>段階0 好みのタイプ</b>：体型や年齢の好みを確認</li>' +
          '<li><b>段階1 ざっくり比較</b>：「年収 vs 顔」のように項目名で比べる</li>' +
          '<li><b>段階2 トレードオフ比較</b>：具体的な2人のどちらに惹かれるか</li>' +
          '<li><b>段階3 条件付き比較</b>（任意）：理想の水準まで絞り込む</li>' +
        '</ol>' +
      '</section>'
    );
    on('[data-start]', 'click', function () { state.screen = 'profile'; save(); render(); });
    on('[data-resume]', 'click', function () { state.screen = state.profile ? 'quiz' : 'profile'; save(); render(); });
    on('[data-restart]', 'click', function () {
      if (!window.confirm('これまでの回答を消して、最初からやり直しますか？')) return;
      clearSaved(); state = fresh(); state.screen = 'profile'; save(); render();
    });
  }

  // ---------------------------------------------------------------- 基本情報
  function seg(name, values, cur) {
    return '<div class="seg" role="radiogroup">' + values.map(function (v) {
      return '<label class="segopt"><input type="radio" name="' + name + '" value="' + esc(v) + '"' + (cur === v ? ' checked' : '') + '><span>' + esc(v) + '</span></label>';
    }).join('') + '</div>';
  }
  function renderProfile() {
    renderProgress({ stage: null, name: '基本情報', index: 0, total: 0 });
    var d = state.profile || state.draft || {};
    var inc = '<option value="">答えない</option>';
    for (var v = 0; v <= 2000; v += 50) {
      inc += '<option value="' + v + '"' + (d.income === v ? ' selected' : '') + '>' + (v === 2000 ? '2000万円以上' : v + '万円') + '</option>';
    }
    h(
      '<form class="form" novalidate>' +
        '<h2 class="qtitle">まずは、あなたについて教えてください</h2>' +
        '<p class="small">入力内容はこの端末にだけ保存され、出題する数値（年収・身長・年齢）の計算に使います。</p>' +
        field('ニックネーム', 'name', '<input type="text" name="name" maxlength="' + NAME_MAX + '" autocomplete="nickname" placeholder="例：ゆう" value="' + esc(state.name || '') + '"><p class="hint">結果の画像と投稿文に「○○さんの妥協できない条件TOP3」と表示されます（' + NAME_MAX + '文字まで）</p>') +
        field('自分の性別', 'myGender', seg('myGender', ['男性', '女性'], d.myGender)) +
        field('恋愛対象の性別', 'targetGender', seg('targetGender', ['男性', '女性'], d.targetGender)) +
        field('自分の年齢', 'age', '<div class="unit"><input type="number" name="age" inputmode="numeric" min="20" max="65" placeholder="例：30" value="' + (d.age != null ? d.age : '') + '"><span>歳</span></div><p class="hint">20〜65歳</p>') +
        field('自分の年収（任意）', 'income', '<select name="income">' + inc + '</select><p class="hint">未入力の場合、詳しい診断の年収水準は「相手の同年代平均」を基準にします</p>') +
        field('自分の身長', 'height', '<div class="unit"><input type="number" name="height" inputmode="numeric" min="130" max="210" placeholder="例：165" value="' + (d.height != null ? d.height : '') + '"><span>cm</span></div><p class="hint">130〜210cm</p>') +
        field('自分はタバコを吸う？', 'mySmoke', seg('mySmoke', ['吸わない', '加熱式', '紙タバコ'], d.mySmoke) +
          '<p class="hint">吸う人には「相手があなたの喫煙に寛容か」を、吸わない人には「相手が吸うか」を聞きます</p>') +
        field('自分はお酒を飲む？', 'myDrink', seg('myDrink', ['飲まない', 'たまに飲む', 'よく飲む'], d.myDrink)) +
        field('目的', 'purpose', seg('purpose', ['恋活', '婚活'], d.purpose)) +
        field('性生活（大人の話）に関する質問', 'adult', seg('adult', ['含める', '含めない'], d.adult === true ? '含める' : d.adult === false ? '含めない' : null) +
          '<p class="hint">「含めない」を選ぶと、性生活や胸のサイズなどの質問は出しません</p>') +
        '<div class="nav">' + backButton() + '<button type="submit" class="btn primary">次へ</button></div>' +
      '</form>'
    );
    var form = app.querySelector('form');
    function read() {
      var fd = function (n) { var el = form.querySelector('[name="' + n + '"]:checked') || form.querySelector('[name="' + n + '"]:not([type=radio])'); return el ? el.value : ''; };
      var num = function (s) { return s === '' ? null : Number(s); };
      return {
        myGender: fd('myGender') || null, targetGender: fd('targetGender') || null,
        age: num(fd('age')), income: num(fd('income')), height: num(fd('height')), purpose: fd('purpose') || null,
        adult: fd('adult') === '含める' ? true : fd('adult') === '含めない' ? false : null,
        mySmoke: fd('mySmoke') || null, myDrink: fd('myDrink') || null,
      };
    }
    function readName() { return cleanName(form.querySelector('[name="name"]').value); }
    form.addEventListener('input', function () { state.draft = read(); state.name = readName(); save(); });
    form.addEventListener('change', function () { state.draft = read(); state.name = readName(); save(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var p = read();
      var err = E.validateProfile(p);
      var name = readName();
      if (!name) err = Object.assign({ name: 'ニックネームを入力してください' }, err);
      Array.prototype.forEach.call(form.querySelectorAll('.err'), function (el) { el.textContent = ''; });
      var keys = Object.keys(err);
      if (keys.length) {
        keys.forEach(function (k) { var el = form.querySelector('[data-err="' + k + '"]'); if (el) el.textContent = err[k]; });
        var first = form.querySelector('[data-field="' + keys[0] + '"]');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      // 基本情報が変わったら、それまでの回答は使えない
      if (state.profile && JSON.stringify(state.profile) !== JSON.stringify(p)) state.answers = [];
      state.profile = p; state.draft = p; state.name = name; state.screen = 'quiz';
      save(); render();
    });
    on('[data-back]', 'click', function () { state.screen = 'top'; save(); render(); });
  }
  function field(label, name, inner) {
    return '<div class="field" data-field="' + name + '"><div class="flabel">' + esc(label) + '</div>' + inner + '<p class="err" data-err="' + name + '"></p></div>';
  }

  // ---------------------------------------------------------------- 質問
  function answer(id, v) {
    prevAnswer = null;
    state.answers.push({ id: id, v: v });
    save(); render();
  }
  function goBack() {
    prefDraft = null;
    if (!state.answers.length) { state.screen = 'profile'; save(); render(); return; }
    prevAnswer = state.answers.pop();
    save(); render();
  }
  function wasPicked(q, v) { return prevAnswer && prevAnswer.id === q.id && prevAnswer.v === v ? ' was' : ''; }

  function renderQuiz() {
    var step = E.run(state);
    if (step.invalidFrom != null) {
      state.answers = state.answers.slice(0, step.invalidFrom);
      save();
      step = E.run(state);
    }
    if (step.type === 'result') return renderResult(step);
    var q = step.q;
    var pr = q.progress;
    if (q.kind === 'gate') renderProgress({ stage: 2, name: '段階2：トレードオフ比較　完了', index: pr.total, total: pr.total });
    else renderProgress({ stage: pr.stage, name: pr.stageName, index: pr.index, total: pr.total });
    if (q.kind === 'pref') renderPref(q);
    else if (q.kind === 'pair') renderPair(q);
    else if (q.kind === 'scenario') renderScenario(q);
    else if (q.kind === 'gate') renderGate(q);
    else if (q.kind === 'profile') renderProfileQ(q);
    if (q.kind !== 'pref') on('[data-back]', 'click', goBack); // 段階0は renderPref 内で登録（再描画するため）
  }

  // 段階0：好みを1つ選ぶ →（NG を聞く質問なら）NG を複数選ぶ → 次へ
  var prefDraft = null; // { id, p, ng: [] }
  function renderPref(q) {
    if (!prefDraft || prefDraft.id !== q.id) {
      var prev = prevAnswer && prevAnswer.id === q.id && prevAnswer.v && typeof prevAnswer.v === 'object' ? prevAnswer.v : null;
      prefDraft = { id: q.id, p: prev ? prev.p : null, ng: prev ? prev.ng.slice() : [] };
    }
    var d = prefDraft;
    var real = q.options.filter(function (o) { return o.v !== 'any'; });
    var ngChoices = real.filter(function (o) { return o.v !== d.p; });
    var showNg = q.ng && d.p != null && d.p !== 'any';
    h(
      '<section class="q">' +
        '<p class="qlead">あなたの好みを教えてください</p>' +
        '<h2 class="qtitle">' + esc(q.title) + '</h2>' +
        (q.image ? '<figure class="ref" hidden><img src="' + esc(q.image) + '" alt="' + esc(q.caption) + '"><figcaption>' + esc(q.caption) + '</figcaption></figure>' : '') +
        '<div class="opts">' + q.options.map(function (o, i) {
          return '<button type="button" class="opt' + (o.v === 'any' ? ' any' : '') + (d.p === o.v ? ' sel' : '') + '" data-i="' + i + '" aria-pressed="' + (d.p === o.v) + '">' + esc(o.label) + '</button>';
        }).join('') + '</div>' +
        (showNg
          ? '<div class="ngbox" id="ngbox">' +
              '<p class="nghead">逆に、<b>これは絶対にNG</b>というものは？<span>（複数選べます。「できれば好み」程度なら選ばなくてOK）</span></p>' +
              '<div class="ngchips">' + ngChoices.map(function (o) {
                var on = d.ng.indexOf(o.v) >= 0;
                return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-ng="' + esc(o.v) + '" aria-pressed="' + on + '">' + (on ? '✕ ' : '') + esc(String(o.label).split('：')[0]) + '</button>';
              }).join('') + '</div>' +
              '<button type="button" class="btn primary big" data-next>' + (d.ng.length ? 'NG ' + d.ng.length + '件で次へ' : 'NGはない・次へ') + '</button>' +
            '</div>'
          : '') +
        '<div class="nav">' + backButton() + '</div>' +
      '</section>'
    );
    on('[data-i]', 'click', function () {
      var v = q.options[+this.getAttribute('data-i')].v;
      // NG を聞かない質問と「こだわらない」は、そのまま次へ
      if (!q.ng || v === 'any') { prefDraft = null; answer(q.id, { p: v, ng: [] }); return; }
      d.p = v;
      d.ng = d.ng.filter(function (x) { return x !== v; });
      var y = window.scrollY;
      renderPref(q);
      window.scrollTo(0, y);
      var box = document.getElementById('ngbox');
      if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    on('[data-ng]', 'click', function () {
      var v = this.getAttribute('data-ng'), k = d.ng.indexOf(v);
      if (k >= 0) d.ng.splice(k, 1); else d.ng.push(v);
      var y = window.scrollY;
      renderPref(q);
      window.scrollTo(0, y);
    });
    on('[data-next]', 'click', function () {
      var v = { p: d.p, ng: d.ng.slice() };
      prefDraft = null;
      answer(q.id, v);
    });
    // 参考画像は読み込めたときだけ表示する（未配置でも診断はそのまま動く）
    showWhenLoaded([q.image], app.querySelector('figure.ref'));
    on('[data-back]', 'click', goBack);
  }

  function renderPair(q) {
    var L = q.swap ? q.b : q.a, R = q.swap ? q.a : q.b;
    function card(it) {
      return '<button type="button" class="vcard' + wasPicked(q, it.id) + '" data-v="' + esc(it.id) + '">' +
        '<span class="vname">' + esc(it.name) + '</span><span class="vdesc">' + esc(it.desc) + '</span><span class="vact">を優先</span></button>';
    }
    h(
      '<section class="q">' +
        '<p class="qlead">相手に求める条件として</p>' +
        '<h2 class="qtitle">どちらを優先しますか？</h2>' +
        '<div class="vs">' + card(L) + '<span class="vsmark">VS</span>' + card(R) + '</div>' +
        '<div class="row sub">' +
          '<button type="button" class="btn' + wasPicked(q, 'tie') + '" data-v="tie">同じくらい大事</button>' +
          '<button type="button" class="btn' + wasPicked(q, 'none') + '" data-v="none">どちらも気にしない</button>' +
        '</div>' +
        '<div class="nav">' + backButton() + '</div>' +
      '</section>'
    );
    on('[data-v]', 'click', function () { answer(q.id, this.getAttribute('data-v')); });
  }

  function renderScenario(q) {
    var A = q.swap ? q.bText : q.aText, B = q.swap ? q.aText : q.bText;
    var sign = q.swap ? -1 : 1;
    var scale = [
      { label: 'Aがいい', v: 2 }, { label: 'ややA', v: 1 }, { label: 'どちらとも言えない', v: 0 },
      { label: 'ややB', v: -1 }, { label: 'Bがいい', v: -2 },
    ];
    h(
      '<section class="q">' +
        '<p class="qlead">ほかの条件は同じだとしたら</p>' +
        '<h2 class="qtitle">どちらの人に惹かれますか？</h2>' +
        sceneImage(q) +
        '<div class="pcards">' +
          '<div class="pcard a"><span class="ptag">A</span><p>' + esc(A) + '</p></div>' +
          '<div class="pcard b"><span class="ptag">B</span><p>' + esc(B) + '</p></div>' +
        '</div>' +
        '<div class="scale">' + scale.map(function (s, i) {
          var v = s.v * sign; if (v === 0) v = 0; // -0 を避ける
          return '<button type="button" class="sbtn s' + i + wasPicked(q, v) + '" data-v="' + v + '"><span class="dot"></span><span class="slabel">' + s.label + '</span></button>';
        }).join('') + '</div>' +
        '<div class="nav">' + backButton() + '</div>' +
      '</section>'
    );
    on('[data-v]', 'click', function () { answer(q.id, Number(this.getAttribute('data-v'))); });
    if (q.visual && q.visual.a && q.visual.b) showWhenLoaded([q.visual.a.src, q.visual.b.src], app.querySelector('.simg'));
  }
  // 段階2の参考画像：STRIPS の1コマを A・B それぞれに切り出す（表示の A／B に合わせる）
  function sceneImage(q) {
    var v = q.visual;
    if (!v || !v.a || !v.b) return '';
    var first = q.swap ? v.b : v.a, second = q.swap ? v.a : v.b;
    function cell(p, tag) {
      var x = p.n > 1 ? (p.i / (p.n - 1) * 100) + '%' : '0%';
      var nums = String(p.box).split('/').map(Number), ar = nums[0] / nums[1];
      // 縦長のコマは高さの上限に合わせて幅を縮め、コマ全体を表示する
      return '<div class="shalf" style="--ar:' + ar.toFixed(4) + ';aspect-ratio:' + esc(p.box) + ';background-image:url(\'' + esc(p.src) + '\');' +
        'background-size:' + (p.n * 100) + '% auto;background-position:' + x + ' ' + esc(p.y) + '">' +
        '<span class="ptag ' + tag + '">' + tag.toUpperCase() + '</span><span class="scap">' + esc(p.label) + '</span></div>';
    }
    return '<div class="simg" hidden role="img" aria-label="A：' + esc(first.label) + '、B：' + esc(second.label) + '">' +
      cell(first, 'a') + cell(second, 'b') + '</div>';
  }
  // 画像がすべて読み込めたときだけ表示する（未配置なら出さない）
  function showWhenLoaded(srcs, el) {
    srcs = (srcs || []).filter(Boolean);
    if (!srcs.length || !el) return;
    var left = srcs.length;
    srcs.forEach(function (src) {
      var img = new Image();
      img.onload = function () { if (--left === 0) el.hidden = false; };
      img.src = src;
    });
  }

  function renderGate(q) {
    h(
      '<section class="q gate">' +
        '<h2 class="qtitle">おつかれさまでした！</h2>' +
        '<p>ここまでの回答で結果を出せます。</p>' +
        '<p>「さらに詳しく診断する」に進むと、上位4項目について<b>理想の水準</b>（例：年収はいくら以上か、身長は何cmくらいか）まで分かり、結果の精度も上がります。</p>' +
        '<div class="stack">' +
          '<button type="button" class="btn primary big" data-v="more">さらに詳しく診断する（約' + S.stage3Count + '問）</button>' +
          '<button type="button" class="btn big" data-v="finish">結果を見る</button>' +
        '</div>' +
        '<div class="nav">' + backButton() + '</div>' +
      '</section>'
    );
    on('[data-v]', 'click', function () { answer(q.id, this.getAttribute('data-v')); });
  }

  function renderProfileQ(q) {
    var sw = q.swap;
    var rows = q.rows.map(function (r) {
      var a = sw ? r.b : r.a, b = sw ? r.a : r.b;
      return '<tr' + (r.diff ? ' class="diff"' : '') + '><th>' + esc(r.name) + '</th><td>' + esc(a) + '</td><td>' + esc(b) + '</td></tr>';
    }).join('');
    var va = sw ? 'b' : 'a', vb = sw ? 'a' : 'b';
    h(
      '<section class="q">' +
        '<p class="qlead">2人のプロフィールを比べて</p>' +
        '<h2 class="qtitle">どちらの人に会ってみたいですか？</h2>' +
        (q.strips || []).map(function (st, i) {
          return '<figure class="ref s3ref" hidden data-strip="' + i + '"><img src="' + esc(st.src) + '" alt="' + esc(st.caption) + '"><figcaption>' + esc(st.caption) + '</figcaption></figure>';
        }).join('') +
        '<table class="ptable"><thead><tr><th></th><th>Aさん</th><th>Bさん</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="small">色のついた条件だけが違います。それ以外の条件はすべて同じです。</p>' +
        '<div class="row three">' +
          '<button type="button" class="btn primary' + wasPicked(q, va) + '" data-v="' + va + '">Aさん</button>' +
          '<button type="button" class="btn' + wasPicked(q, 'tie') + '" data-v="tie">同じくらい</button>' +
          '<button type="button" class="btn primary' + wasPicked(q, vb) + '" data-v="' + vb + '">Bさん</button>' +
        '</div>' +
        '<div class="nav">' + backButton() + '</div>' +
      '</section>'
    );
    on('[data-v]', 'click', function () { answer(q.id, this.getAttribute('data-v')); });
    (q.strips || []).forEach(function (st, i) { showWhenLoaded([st.src], app.querySelector('[data-strip="' + i + '"]')); });
  }

  // ---------------------------------------------------------------- 結果
  var LABEL_CLASS = { '絶対条件': 'l5', 'かなり重視': 'l4', 'やや重視': 'l3', 'あまり気にしない': 'l2', '気にしない': 'l1' };
  var lastResult = null;

  function renderResult(step) {
    renderProgress(null);
    var R = step.result;
    lastResult = R;
    var p = state.profile;
    var top3 = R.top3.map(function (t, i) {
      return '<li><span class="rank">' + (i + 1) + '</span><span class="tname">' + esc(t.name) + '</span><span class="ttext">' + esc(t.text) + '</span></li>';
    }).join('');
    var gaps = R.gaps.length
      ? '<section class="rsec"><h3>建前と本音のズレ</h3><ul class="gaps">' + R.gaps.map(function (g) {
          return '<li><span class="gicon">!</span>' + esc(g.text) + '</li>';
        }).join('') + '</ul></section>'
      : '';
    var items = R.items.map(function (it) {
      var pct = Math.max(4, Math.round(it.score * 100));
      return '<li class="' + LABEL_CLASS[it.label] + '">' +
        '<div class="ihead"><span class="iname">' + esc(it.name) + '</span><span class="ilabel">' + esc(it.label) + '</span></div>' +
        '<div class="ibar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="iideal"><span>理想</span>' + esc(it.ideal) + '</div>' +
      '</li>';
    }).join('');
    h(
      '<section class="result">' +
        '<div id="resultCard" class="rcard">' +
          '<p class="kicker">' + esc(state.name) + 'さん（' + esc(p.age) + '歳・' + esc(p.purpose) + '中）の</p>' +
          '<h2 class="rtitle">妥協できない条件 TOP3</h2>' +
          '<ol class="top3">' + top3 + '</ol>' +
          (R.ngs.length ? '<section class="rsec"><h3>絶対NG</h3><ul class="nglist">' + R.ngs.map(function (n) {
            return '<li><span class="ngname">' + esc(n.name) + '</span>' + esc(n.text) + '</li>';
          }).join('') + '</ul></section>' : '') +
          gaps +
          '<section class="rsec"><h3>項目別の重視度</h3><ul class="ilist">' + items + '</ul>' +
          '<p class="more-note">ほか' + Math.max(0, R.items.length - 10) + '項目の結果はサイトで</p></section>' +
          '<p class="rnote">年収の基準値は統計をもとにした概算です（想定する相手：' + R.partnerAge + '歳・東京都の同年代平均 年収' + R.R + '万円）。</p>' +
          '<p class="rsite">本音の優先順位診断 ' + esc(HASHTAG) + '</p>' +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" class="btn primary" data-save>結果を画像で保存</button>' +
          '<button type="button" class="btn primary" data-share>X（旧Twitter）共有用テキストを作る</button>' +
          '<div id="sharebox" class="sharebox" hidden></div>' +
          (step.canMore ? '<button type="button" class="btn" data-more>さらに詳しく診断する（約' + S.stage3Count + '問）</button>' : '') +
          '<button type="button" class="btn" data-restart>もう一度診断する</button>' +
        '</div>' +
        '<div class="nav">' + backButton() + '</div>' +
        '<p class="small center">この診断はエンタメ・自己分析目的です。年収などの数値は東京都内・近郊の統計をもとにした概算です。</p>' +
      '</section>'
    );
    on('[data-back]', 'click', goBack);
    on('[data-save]', 'click', saveImage);
    on('[data-share]', 'click', showShare);
    on('[data-more]', 'click', function () {
      var gi = -1;
      state.answers.forEach(function (a, i) { if (a.id === 'gate') gi = i; });
      if (gi < 0) return;
      state.answers = state.answers.slice(0, gi).concat([{ id: 'gate', v: 'more' }]);
      save(); render();
    });
    on('[data-restart]', 'click', function () {
      if (!window.confirm('これまでの回答と結果を消して、もう一度診断しますか？')) return;
      clearSaved(); state = fresh(); save(); render();
    });
  }

  // ---------------------------------------------------------------- 共有テキスト
  function siteUrl() { return location.href.replace(/[?#].*$/, ''); }
  function xLength(s) {
    // X の文字数（日本語などは2、URLは23として数える概算）
    var t = s.replace(/https?:\/\/\S+/g, ''), n = (s.match(/https?:\/\/\S+/g) || []).length * 23;
    for (var i = 0; i < t.length; i++) n += t.charCodeAt(i) > 0x10ff ? 2 : 1;
    return n;
  }
  function shareText(R) {
    var url = siteUrl();
    function build(full) {
      return '恋活・婚活「本音の優先順位診断」をやってみた！\n' + state.name + 'さんの妥協できない条件TOP3\n' +
        R.top3.map(function (t, i) { return (i + 1) + '. ' + t.name + (full ? '：' + t.text : ''); }).join('\n') +
        '\n' + HASHTAG + '\n' + url;
    }
    var s = build(true);
    return xLength(s) <= 280 ? s : build(false);
  }
  function showShare() {
    var box = document.getElementById('sharebox');
    var text = shareText(lastResult);
    box.innerHTML =
      '<textarea readonly rows="7">' + esc(text) + '</textarea>' +
      '<div class="row"><button type="button" class="btn" data-copy>コピー</button>' +
      '<a class="btn primary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=' + encodeURIComponent(text) + '">Xで投稿する</a></div>' +
      '<p class="small" data-copied></p>';
    box.hidden = false;
    box.querySelector('[data-copy]').addEventListener('click', function () {
      var ta = box.querySelector('textarea'), msg = box.querySelector('[data-copied]');
      function done() { msg.textContent = 'コピーしました'; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { msg.textContent = '長押しでコピーしてください'; } });
      } else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { msg.textContent = '長押しでコピーしてください'; } }
    });
  }

  // ---------------------------------------------------------------- 結果画像（html2canvas）
  var h2cPromise = null;
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (h2cPromise) return h2cPromise;
    h2cPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = H2C_URL; s.integrity = H2C_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas')); };
      s.onerror = function () { h2cPromise = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return h2cPromise;
  }
  function saveImage() {
    var btn = app.querySelector('[data-save]');
    btn.disabled = true; btn.textContent = '画像を作成中…';
    var card = document.getElementById('resultCard');
    loadH2C().then(function (html2canvas) {
      return html2canvas(card, {
        scale: 2, backgroundColor: getComputedStyle(document.body).backgroundColor, useCORS: true,
        onclone: function (doc) { var c = doc.getElementById('resultCard'); if (c) c.classList.add('capturing'); },
      });
    }).then(function (canvas) {
      var url = canvas.toDataURL('image/png');
      showImageModal(url);
    }).catch(function () {
      window.alert('画像を作成できませんでした。通信状況を確認するか、スクリーンショットをご利用ください。');
    }).then(function () {
      btn.disabled = false; btn.textContent = '結果を画像で保存';
    });
  }
  function fileName() {
    var n = state.name.replace(/[\\/:*?"<>|]/g, '').trim();
    return 'honne-priority' + (n ? '_' + n : '') + '.png';
  }
  function showImageModal(url) {
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML =
      '<div class="mbox" role="dialog" aria-label="結果画像">' +
        '<img src="' + url + '" alt="診断結果の画像">' +
        '<p class="small">スマホの方は、画像を長押しして保存してください。</p>' +
        '<div class="row"><a class="btn primary" download="' + esc(fileName()) + '" href="' + url + '">ダウンロード</a>' +
        '<button type="button" class="btn" data-close>閉じる</button></div>' +
      '</div>';
    document.body.appendChild(m);
    function close() { m.remove(); }
    m.addEventListener('click', function (ev) { if (ev.target === m || ev.target.hasAttribute('data-close')) close(); });
  }

  // ---------------------------------------------------------------- 起動
  document.getElementById('homeLink').addEventListener('click', function (ev) {
    ev.preventDefault();
    state.screen = 'top'; save(); render();
  });
  render();
})();
