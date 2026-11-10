/*
 * 診断エンジン（DOM を使わない。ブラウザでも Node.js でも動く）
 *
 * 状態は { seed, profile, answers } だけ。run(state) が毎回最初から回答を再生して、
 * 次の質問か結果を返す（乱数はシード付きなので決定的）。「戻る」は answers を1つ削るだけ。
 * answers の要素：{ id: 質問id, v: 回答 }
 */
(function (root, factory) {
  var D = root.HONNE_DATA || (typeof require === 'function' ? require('./data.js') : null);
  var E = factory(D);
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.HonneEngine = E;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  var S = D.SETTINGS;

  // ---------------------------------------------------------------- 基本
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round50(x) { return Math.round(x / 50) * 50; }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function signed(n, unit) { return (n > 0 ? '＋' : n < 0 ? '−' : '±') + Math.abs(n) + (unit || ''); }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFor(seed, tag) { return mulberry32(hashStr(String(seed) + '|' + tag)); }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function forTarget(x, ctx) {
    if (x.target && x.target !== '共通' && x.target !== ctx.tg) return false;
    if (x.purpose && x.purpose !== ctx.p.purpose) return false;
    if (x.adult && !ctx.p.adult) return false; // 性生活の質問を含めない人には出さない
    return true;
  }

  var PREF_BY_KEY = {}, PREF_BY_LABEL = {}, ITEM_BY_ID = {}, PREF_ITEM = {};
  D.PREFS.forEach(function (p) { PREF_BY_KEY[p.key] = p; PREF_BY_LABEL[p.label] = p.key; });
  D.ITEMS.forEach(function (it) { ITEM_BY_ID[it.id] = it; });
  // 段階0の質問 → NG を反映する項目
  D.PREFS.forEach(function (p) {
    if (p.item) { PREF_ITEM[p.key] = p.item; return; }
    D.ITEMS.forEach(function (it) { if (it.pref === p.key && !PREF_ITEM[p.key]) PREF_ITEM[p.key] = it.id; });
  });

  // 自分の喫煙・飲酒に応じた差し替え（variants）
  function flagsOf(profile) {
    return { smoker: !!profile.mySmoke && profile.mySmoke !== '吸わない', drinker: !!profile.myDrink && profile.myDrink !== '飲まない' };
  }
  function resolve(obj, ctx) {
    if (!obj.variants) return obj;
    for (var i = 0; i < obj.variants.length; i++) {
      var w = obj.variants[i].when || {}, hit = true;
      Object.keys(w).forEach(function (k) { if (ctx.flags[k] !== w[k]) hit = false; });
      if (hit) {
        var out = {}, k;
        for (k in obj) if (k !== 'variants') out[k] = obj[k];
        for (k in obj.variants[i]) if (k !== 'when') out[k] = obj.variants[i][k];
        return out;
      }
    }
    return obj;
  }

  // ---------------------------------------------------------------- 基本情報
  function validateProfile(p) {
    var err = {};
    p = p || {};
    if (p.myGender !== '男性' && p.myGender !== '女性') err.myGender = '性別を選んでください';
    if (p.targetGender !== '男性' && p.targetGender !== '女性') err.targetGender = '恋愛対象の性別を選んでください';
    if (!(Number.isInteger(p.age) && p.age >= 20 && p.age <= 65)) err.age = '年齢は20〜65歳の整数で入力してください';
    if (p.income != null && !(Number.isInteger(p.income) && p.income >= 0 && p.income <= 2000 && p.income % 50 === 0)) err.income = '年収を選び直してください';
    if (!(Number.isInteger(p.height) && p.height >= 130 && p.height <= 210)) err.height = '身長は130〜210cmの整数で入力してください';
    if (p.purpose !== '恋活' && p.purpose !== '婚活') err.purpose = '目的を選んでください';
    if (p.adult !== true && p.adult !== false) err.adult = '性生活の質問を含めるかどうかを選んでください';
    if (['吸わない', '加熱式', '紙タバコ'].indexOf(p.mySmoke) < 0) err.mySmoke = 'タバコを吸うかどうかを選んでください';
    if (['飲まない', 'たまに飲む', 'よく飲む'].indexOf(p.myDrink) < 0) err.myDrink = 'お酒を飲むかどうかを選んでください';
    return err;
  }

  // ---------------------------------------------------------------- 数値の算出
  function avgIncome(gender, age) {
    var t = D.INCOME_TABLE;
    for (var i = 0; i < t.length; i++) if (age >= t[i].min && age <= t[i].max) return t[i][gender];
    return age < t[0].min ? t[0][gender] : t[t.length - 1][gender];
  }
  function ageOffset(pref) {
    for (var i = 0; i < D.AGE_OPTIONS.length; i++) if (D.AGE_OPTIONS[i].v === pref) return D.AGE_OPTIONS[i].off;
    return 0; // 同年代・こだわらない
  }
  function partnerAgeFor(age, pref) { return clamp(age + ageOffset(pref), S.ageMin, S.ageMax); }

  function makeCtx(profile, prefs, ngs) {
    var tg = profile.targetGender;
    var hr = S.partnerHeightRange[tg];
    var ctx = { p: profile, tg: tg, prefs: prefs || {}, ngs: ngs || {}, flags: flagsOf(profile), hMin: hr[0], hMax: hr[1] };
    ctx.partnerAge = partnerAgeFor(profile.age, ctx.prefs.age);
    ctx.R = avgIncome(tg, ctx.partnerAge);
    return ctx;
  }

  // 年収（フルタイム）＝ R×k を50万円単位、下限250万
  function incomeValue(ctx, k) { return Math.max(S.incomeFloorFullTime, round50(ctx.R * k)); }
  function incomeText(ctx, v, noDiff) {
    var s = '年収' + v + '万円';
    if (!noDiff && ctx.p.income != null) {
      var d = v - ctx.p.income;
      s += '（' + (d === 0 ? 'あなたと同じ' : 'あなた' + signed(d, '万')) + '）';
    }
    return s;
  }
  function ageText(n, a) {
    var d = n - a;
    return n + '歳（' + (d === 0 ? 'あなたと同い年' : 'あなたより' + Math.abs(d) + '歳' + (d > 0 ? '年上' : '年下')) + '）';
  }
  function heightText(n, h) {
    var d = n - h;
    return '身長' + n + 'cm（' + (d === 0 ? 'あなたと同じくらい' : 'あなた' + signed(d, 'cm')) + '）';
  }

  // ---------------------------------------------------------------- 段階0の選択肢
  function normOpt(o) {
    if (typeof o === 'string') o = { v: o };
    return {
      v: o.v, label: o.label || o.v, text: o.text || o.label || o.v,
      ideal: o.ideal || o.label || o.v, agree: o.agree || null, disagree: o.disagree || null, ngLabel: o.ngLabel || null,
    };
  }
  function ageOptions(ctx) {
    var a = ctx.p.age, out = [];
    D.AGE_OPTIONS.forEach(function (o) {
      var rep = a + o.off;
      if (rep < S.ageMin || rep > S.ageMax) return; // 相手が20歳未満・65歳超になる選択肢は出さない
      var lo = clamp(a + o.lo, S.ageMin, S.ageMax), hi = clamp(a + o.hi, S.ageMin, S.ageMax);
      var range = lo === hi ? lo + '歳' : lo + '〜' + hi + '歳';
      out.push({ v: o.v, label: o.label + '（' + range + '）', value: rep, text: ageText(rep, a), ideal: o.label + '（' + range + '）' });
    });
    return out;
  }
  function heightOptions(ctx) {
    var h = ctx.p.height, out = [];
    D.HEIGHT_OPTIONS.forEach(function (o) {
      var lo = o.lo == null ? ctx.hMin : Math.max(ctx.hMin, h + o.lo);
      var hi = o.hi == null ? ctx.hMax : Math.min(ctx.hMax, h + o.hi);
      if (lo > hi) return; // 相手の身長の範囲に入らない選択肢は出さない
      var rep = clamp(h + o.d, lo, hi);
      var range = heightRange(o, lo, hi);
      out.push({ v: o.v, label: o.label + '：' + range, value: rep, text: heightText(rep, h), ideal: o.label + '：' + range });
    });
    return out;
  }
  function heightRange(o, lo, hi) {
    return o.lo == null ? '〜' + hi + 'cm' : o.hi == null ? lo + 'cm〜' : (lo === hi ? lo + 'cm' : lo + '〜' + hi + 'cm');
  }
  // 水準が多すぎるときは、相手の平均（center）から最も遠い端の水準を外す
  function trimLevels(bands, center) {
    while (bands.length > S.maxLevels) {
      var a = bands[0], z = bands[bands.length - 1];
      if (Math.abs(a.rep - center) > Math.abs(z.rep - center)) bands.shift(); else bands.pop();
    }
    return bands.map(function (b) { return b.l; });
  }
  function prefOptions(p, ctx) {
    if (p.compute === 'age') return ageOptions(ctx);
    if (p.compute === 'height') return heightOptions(ctx);
    var list = Array.isArray(p.options) ? p.options : p.options[ctx.tg];
    return list.map(normOpt);
  }
  function prefQuestions(ctx) {
    return D.PREFS.filter(function (p) { return forTarget(p, ctx); }).map(function (p) {
      var opts = prefOptions(p, ctx).map(function (o) { return { v: o.v, label: o.label }; });
      if (!p.noAny) opts.push({ v: 'any', label: S.anyLabel });
      var img = p.image ? (typeof p.image === 'string' ? p.image : p.image[ctx.tg]) : null;
      var caption = img ? '参考イメージ（左から：' + opts.filter(function (o) { return o.v !== 'any'; }).map(function (o) { return o.label; }).join('／') + '）' : null;
      return { kind: 'pref', stage: 0, id: 'p:' + p.key, key: p.key, title: p.q, options: opts, image: img || null, caption: caption, ng: !p.noNg };
    });
  }

  // 好みの選択肢と、最も遠い選択肢（〔好みでない〕）
  function prefPair(ctx, key) {
    var p = PREF_BY_KEY[key];
    var v = ctx.prefs[key];
    if (!p || v == null || v === 'any') return null;
    var opts = prefOptions(p, ctx);
    var idx = -1;
    for (var i = 0; i < opts.length; i++) if (opts[i].v === v) idx = i;
    if (idx < 0) return null;
    var pref = opts[idx], anti = null;
    var ng = (ctx.ngs && ctx.ngs[key]) || [];
    var usable = function (o) { return o && o.v !== v && ng.indexOf(o.v) < 0; };
    if (p.compute === 'age') {
      // 好みと反対側に antiAgeGap 歳。NG の区分・範囲外なら反対方向も試す
      var a = ctx.p.age, g = S.antiAgeGap;
      var first = v === '年上' ? -g : v === '年下' ? g : (a + g <= S.ageMax ? g : -g);
      [first, -first].forEach(function (d) {
        if (anti) return;
        var n = a + d, band = d > 0 ? '年上' : '年下';
        if (n < S.ageMin || n > S.ageMax || band === v || ng.indexOf(band) >= 0) return;
        anti = { v: band, value: n, text: ageText(n, a), label: band };
      });
      return { pref: pref, anti: anti, opts: opts };
    }
    if (p.opposite && p.opposite[v]) {
      p.opposite[v].split('|').forEach(function (c) {
        if (anti) return;
        opts.forEach(function (o) { if (!anti && o.v === c && usable(o)) anti = o; });
      });
    }
    if (!anti) {
      // 好みから最も遠い選択肢（NG は使わない）
      var order = opts.map(function (o, i) { return i; }).sort(function (x, y) { return Math.abs(y - idx) - Math.abs(x - idx) || y - x; });
      order.forEach(function (i) { if (!anti && usable(opts[i])) anti = opts[i]; });
    }
    return { pref: pref, anti: anti, opts: opts };
  }

  // ---------------------------------------------------------------- プレースホルダーの展開
  // 展開できないときは null を返す（そのシナリオは出題しない）
  function expand(text, ctx, scen, opt) {
    var ok = true, noDiff = opt && opt.noDiff;
    var out = text.replace(/〔(好みでない|好みの)([^〕]+)〕/g, function (m, kind, label) {
      var key = PREF_BY_LABEL[label];
      var pp = key ? prefPair(ctx, key) : null;
      var o = pp && (kind === '好みの' ? pp.pref : pp.anti);
      if (!o) { ok = false; return ''; }
      return o.text;
    });
    out = out.replace(/〔考えが(一致|違う)〕/g, function (m, kind) {
      var pp = scen && scen.about ? prefPair(ctx, scen.about) : null;
      var t = pp && (kind === '一致' ? pp.pref.agree : pp.pref.disagree);
      if (!t) { ok = false; return ''; }
      return t;
    });
    out = out.replace(/〔大きく年下〕/g, function () {
      var a = ctx.p.age, gaps = S.bigYoungerGaps;
      for (var i = 0; i < gaps.length; i++) if (a - gaps[i] >= S.ageMin) return ageText(a - gaps[i], a);
      ok = false; return '';
    });
    out = out.replace(/\{年収×([\d.]+)〜([\d.]+)\}/g, function (m, k1, k2) {
      return incomeValue(ctx, +k1) + '万〜' + incomeValue(ctx, +k2) + '万円';
    });
    out = out.replace(/\{年収×([\d.]+)\}/g, function (m, k) { return incomeText(ctx, incomeValue(ctx, +k), noDiff); });
    out = out.replace(/\{貯金×([\d.]+)\}/g, function (m, k) { return Math.max(50, round50(ctx.R * +k)) + '万円'; });
    if (/[〔〕{}]/.test(out)) ok = false; // 未知のプレースホルダー
    return ok ? out : null;
  }

  function scenarioTexts(s, ctx) {
    s = resolve(s, ctx);
    if (!forTarget(s, ctx)) return null;
    var c = s.cond || {};
    if (c.purpose && c.purpose !== ctx.p.purpose) return null;
    if (c.minAge != null && ctx.p.age < c.minAge) return null;
    if (c.maxAge != null && ctx.p.age > c.maxAge) return null;
    var a = expand(s.a.text, ctx, s), b = expand(s.b.text, ctx, s);
    if (a == null || b == null) return null;
    return { a: a, b: b };
  }

  // ---------------------------------------------------------------- 項目と水準
  function itemsFor(ctx) {
    return D.ITEMS.filter(function (it) { return forTarget(it, ctx); }).map(function (it) { return resolve(it, ctx); });
  }
  function itemMap(ctx) { var m = {}; itemsFor(ctx).forEach(function (it) { m[it.id] = it; }); return m; }

  // 段階3の水準：[{ label, short }]（先頭ほど一般に良いとされる順）
  function itemLevels(item, ctx) {
    var L = [];
    if (item.levels === 'income') {
      // 自分（未入力なら相手の同年代平均）を基準に5区分。相手の平均年収 R から遠い端は外して最大4つ
      var hasMine = ctx.p.income != null;
      var base = hasMine ? ctx.p.income : ctx.R;
      var eff = Math.max(base, S.incomeFloorFullTime);
      var rel = eff === base ? (hasMine ? '自分' : '同年代平均') : null;
      var step = round50(Math.max(100, eff * 0.25));
      var hh = Math.max(50, round50(step / 2)), HH = round50(step * 1.5);
      var F = S.incomeLevelFloor, bands = [];
      [
        { lo: eff + HH, hi: null, t: '＋' + HH + '万以上' },
        { lo: eff + hh, hi: eff + HH, t: '＋' + hh + '〜' + HH + '万' },
        { lo: eff - hh, hi: eff + hh, t: '±' + hh + '万' },
        { lo: eff - HH, hi: eff - hh, t: '−' + hh + '〜' + HH + '万' },
        { lo: null, hi: eff - HH, t: '−' + HH + '万以下' },
      ].forEach(function (d) {
        if (d.hi != null && d.hi <= F) return; // 下限（200万）未満だけの区分は出さない
        var clipped = d.lo != null && d.lo < F;
        var lo = d.lo == null ? null : Math.max(F, d.lo), hi = d.hi;
        if (lo != null && hi != null && lo >= hi) return;
        var abs = lo == null ? '〜' + hi + '万' : hi == null ? lo + '万〜' : lo + '〜' + hi + '万';
        var r = lo == null ? hi - hh : hi == null ? lo + hh : (lo + hi) / 2;
        var useRel = rel && !clipped;
        bands.push({
          l: lvl(useRel ? rel + d.t + '（年収' + abs + '）' : '年収' + abs, useRel ? rel + d.t + '（' + abs + '）' : abs),
          rep: r,
        });
      });
      return trimLevels(bands, ctx.R);
    }
    if (item.levels === 'height') {
      // 段階0と同じ5区分。相手の身長の範囲外は出さず、平均身長から遠い端は外して最大4つ
      var h = ctx.p.height, hb = [];
      D.HEIGHT_OPTIONS.forEach(function (o) {
        var lo = o.lo == null ? ctx.hMin : Math.max(ctx.hMin, h + o.lo);
        var hi = o.hi == null ? ctx.hMax : Math.min(ctx.hMax, h + o.hi);
        if (lo > hi) return;
        hb.push({ l: lvl(o.rel + '（' + heightRange(o, lo, hi) + '）'), rep: clamp(h + o.d, lo, hi) });
      });
      return trimLevels(hb, S.avgHeight[ctx.tg]);
    }
    if (item.levels === 'age') {
      var a = ctx.p.age;
      if (a + 5 <= S.ageMax) L.push(lvl('5歳以上年上（' + (a + 5) + '歳〜）'));
      L.push(lvl('自分±2歳（' + Math.max(S.ageMin, a - 2) + '〜' + Math.min(S.ageMax, a + 2) + '歳）'));
      if (a - 5 >= S.ageMin) L.push(lvl('5歳以上年下（〜' + (a - 5) + '歳）'));
      return L;
    }
    if (item.levels === 'body' || (item.levels && item.levels.pref)) {
      var pkey = item.levels === 'body' ? 'body' : item.levels.pref;
      var opts = prefOptions(PREF_BY_KEY[pkey], ctx);
      var pp = prefPair(ctx, pkey);
      var pick = [];
      if (pp) { pick.push(pp.pref.v); if (pp.anti) pick.push(pp.anti.v); }
      [1, 0, 3, 2].forEach(function (i) { if (opts[i] && pick.length < 3 && pick.indexOf(opts[i].v) < 0) pick.push(opts[i].v); });
      opts.forEach(function (o) { if (pick.indexOf(o.v) >= 0) L.push(lvl(o.v)); });
      return L;
    }
    return item.levels.map(function (s) { return lvl(s); });
  }
  function lvl(label, short) { return { label: label, short: short || label }; }

  // ---------------------------------------------------------------- スコア（Bradley-Terry）
  // comps: [{ a:[id], b:[id], y: Aの勝ち度合い0〜1 }]。'_overall' など ids にない項目は強さ0で固定。
  function fitBT(comps, ids, lambda, init, iters) {
    var th = {}, i, it;
    ids.forEach(function (id) { th[id] = init && init[id] != null ? init[id] : 0; });
    if (!comps.length) return th;
    lambda = lambda == null ? 0.25 : lambda;
    for (it = 0; it < (iters || 300); it++) {
      var g = {};
      ids.forEach(function (id) { g[id] = 0; });
      for (i = 0; i < comps.length; i++) {
        var c = comps[i], d = 0;
        c.a.forEach(function (x) { if (x in th) d += th[x]; });
        c.b.forEach(function (x) { if (x in th) d -= th[x]; });
        var e = c.y - sigmoid(d);
        c.a.forEach(function (x) { if (x in g) g[x] += e; });
        c.b.forEach(function (x) { if (x in g) g[x] -= e; });
      }
      ids.forEach(function (id) { th[id] += 0.3 * (g[id] - lambda * th[id]); });
    }
    return th;
  }

  // 段階1の0〜1スコア（「どちらも気にしない」は下げる）
  function stage1Scores(st, ids) {
    var th = fitBT(st.comps1, ids), out = {};
    ids.forEach(function (id) {
      if (!st.count1[id]) return;
      out[id] = clamp(sigmoid(1.6 * th[id]) - 0.12 * (st.indiff[id] || 0), 0, 1);
    });
    return out;
  }
  function stage2Scores(st, ids) {
    var th = fitBT(st.comps2, ids), out = {};
    ids.forEach(function (id) { if (st.count2[id]) out[id] = sigmoid(1.8 * th[id]); });
    return out;
  }
  function blend(parts) {
    var w = S.weights, sum = 0, tw = 0;
    if (parts.s1 != null) { sum += w.s1 * parts.s1; tw += w.s1; }
    if (parts.s2 != null) { sum += w.s2 * parts.s2; tw += w.s2; }
    if (parts.s3 != null) { sum += w.s3 * parts.s3; tw += w.s3; }
    return tw ? sum / tw : 0.3;
  }

  // ---------------------------------------------------------------- 段階1：出題する組み合わせ
  function pickPair(ids, order, th, count, asked, rng) {
    var unc = order.filter(function (id) { return !count[id]; });
    function key(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
    function bestPartner(i, pool) {
      var best = null, bs = Infinity;
      pool.forEach(function (j) {
        if (j === i || asked[key(i, j)]) return;
        var s = Math.abs(th[i] - th[j]) + 0.25 * (count[j] || 0) + 0.05 * rng();
        if (s < bs) { bs = s; best = j; }
      });
      return best;
    }
    if (unc.length) {
      var i = unc[0];
      var j = unc.length >= 2 ? bestPartner(i, unc) : null;
      if (!j) j = bestPartner(i, ids);
      if (j) return [i, j];
    }
    var bp = null, bs = Infinity;
    for (var x = 0; x < ids.length; x++) for (var y = x + 1; y < ids.length; y++) {
      var a = ids[x], b = ids[y];
      if (asked[key(a, b)]) continue;
      var s = Math.abs(th[a] - th[b]) + 0.25 * ((count[a] || 0) + (count[b] || 0)) + 0.05 * rng();
      if (s < bs) { bs = s; bp = [a, b]; }
    }
    return bp;
  }

  // ---------------------------------------------------------------- 段階2：シナリオの選択
  function selectScenarios(ctx, sc1, seed) {
    var rng = rngFor(seed, 's2select');
    var cands = [];
    D.SCENARIOS.forEach(function (s) {
      var t = scenarioTexts(s, ctx);
      var rs = resolve(s, ctx);
      if (t) cands.push({ s: rs, t: t, items: relatedItems(rs) });
    });
    var chosen = [], cover = {};
    while (chosen.length < S.stage2Count && cands.length) {
      var bi = -1, bs = -Infinity;
      cands.forEach(function (c, i) {
        var sum = 0, n = 0, pen = 0;
        c.items.forEach(function (id) { if (sc1[id] != null) { sum += sc1[id]; n++; } pen += cover[id] || 0; });
        var s = (n ? sum / n : 0.4) - 0.12 * pen + 0.08 * rng();
        if (s > bs) { bs = s; bi = i; }
      });
      var c = cands.splice(bi, 1)[0];
      c.items.forEach(function (id) { cover[id] = (cover[id] || 0) + 1; });
      chosen.push(c);
    }
    return shuffle(chosen, rng);
  }
  function relatedItems(s) {
    var out = [];
    [s.a, s.b].forEach(function (side) {
      side.plus.forEach(function (id) { if (id !== '_overall' && out.indexOf(id) < 0) out.push(id); });
      Object.keys(side.ideal || {}).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    });
    return out;
  }

  // ---------------------------------------------------------------- 段階3：プロフィール比較の設計
  function designStage3(ctx, prov, seed) {
    var rng = rngFor(seed, 's3design');
    var items = itemsFor(ctx).filter(function (it) { return itemLevels(it, ctx).length >= 2; });
    items.sort(function (x, y) { return (prov[y.id] || 0) - (prov[x.id] || 0); });
    var top = items.slice(0, S.stage3Items);
    var levels = {};
    top.forEach(function (it) { levels[it.id] = itemLevels(it, ctx); });
    var pairs = [];
    for (var i = 0; i < top.length; i++) for (var j = i + 1; j < top.length; j++) pairs.push([top[i].id, top[j].id]);
    var seq = [];
    while (seq.length < S.stage3Count && pairs.length) seq = seq.concat(shuffle(pairs, rng));
    seq = seq.slice(0, S.stage3Count);
    // 項目1は A が上・項目2は A が下になるよう交差させた組み合わせを列挙し、未使用のものから選ぶ
    var used = {}, design = [];
    function crossings(n) {
      var out = [];
      for (var x = 0; x < n; x++) for (var y = x + 1; y < n; y++) out.push([x, y]);
      return out;
    }
    seq.forEach(function (pr) {
      var i1 = pr[0], i2 = pr[1], combos = [];
      crossings(levels[i1].length).forEach(function (c1) {
        crossings(levels[i2].length).forEach(function (c2) { combos.push([c1, c2]); });
      });
      combos = shuffle(combos, rng);
      var pick = null;
      for (var t = 0; t < combos.length && !pick; t++) {
        if (!used[i1 + i2 + combos[t].join()]) pick = combos[t];
      }
      var fresh = !!pick;
      pick = pick || combos[0];
      var sig = i1 + pick[0].join('') + i2 + pick[1].join('');
      used[i1 + i2 + pick.join()] = 1;
      var A = {}, B = {};
      top.forEach(function (it) {
        if (it.id === i1) { A[it.id] = pick[0][0]; B[it.id] = pick[0][1]; }
        else if (it.id === i2) { A[it.id] = pick[1][1]; B[it.id] = pick[1][0]; }
        else { var f = Math.floor(rng() * levels[it.id].length); A[it.id] = f; B[it.id] = f; }
      });
      // 同じ組み合わせが2回目になるときは、固定する項目の水準で区別する
      if (!fresh) sig += 'r' + design.length;
      design.push({ A: A, B: B, vary: [i1, i2], swap: rng() < 0.5, sig: sig });
    });
    return { items: top.map(function (it) { return it.id; }), levels: levels, design: design };
  }

  // ロジスティック回帰で各水準の効用を推定
  function fitStage3(d3, answers) {
    var u = {};
    d3.items.forEach(function (id) { u[id] = d3.levels[id].map(function () { return 0; }); });
    if (!answers.length) return u;
    for (var it = 0; it < 400; it++) {
      var g = {};
      d3.items.forEach(function (id) { g[id] = u[id].map(function () { return 0; }); });
      answers.forEach(function (r) {
        var q = r.q, d = 0;
        d3.items.forEach(function (id) { d += u[id][q.A[id]] - u[id][q.B[id]]; });
        var e = r.y - sigmoid(d);
        d3.items.forEach(function (id) { g[id][q.A[id]] += e; g[id][q.B[id]] -= e; });
      });
      d3.items.forEach(function (id) {
        for (var k = 0; k < u[id].length; k++) u[id][k] += 0.3 * (g[id][k] - 0.08 * u[id][k]);
      });
    }
    return u;
  }

  // ---------------------------------------------------------------- 参考画像
  function stripSrc(key, ctx) {
    var st = D.STRIPS && D.STRIPS[key];
    return st ? st[ctx.tg] || null : null;
  }
  // シナリオの1コマ：{ src, i, n, box, y, label }。i が 'pref:key' / 'anti:key' なら段階0の回答から決める
  function panel(spec, ctx) {
    if (!spec) return null;
    var st = D.STRIPS[spec[0]], src = stripSrc(spec[0], ctx);
    if (!st || !src) return null;
    var i = spec[1], n, label;
    if (typeof i === 'string') {
      var m = i.split(':'), pp = prefPair(ctx, m[1]);
      var o = pp && (m[0] === 'anti' ? pp.anti : pp.pref);
      if (!o) return null;
      i = -1;
      pp.opts.forEach(function (x, k) { if (x.v === o.v) i = k; });
      if (i < 0) return null;
      n = pp.opts.length; label = o.label;
    } else {
      n = st.labels.length; label = st.labels[i];
    }
    return { src: src, i: i, n: n, box: st.box, y: st.y, label: label };
  }
  // 段階3：水準を変える項目に対応する画像
  function stripsFor(itemIds, ctx) {
    var out = [];
    Object.keys(D.STRIPS || {}).forEach(function (k) {
      var st = D.STRIPS[k], src = stripSrc(k, ctx);
      if (st.item && src && itemIds.indexOf(st.item) >= 0) out.push({ src: src, caption: ITEM_BY_ID[st.item].name + 'の参考（左から：' + st.labels.join('／') + '）' });
    });
    return out;
  }

  // ---------------------------------------------------------------- 再生
  var STAGE2_VALUES = [2, 1, 0, -1, -2];

  // 段階0の回答：{ p: 好み, ng: [NG の選択肢] }
  function validPref(q, v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.ng)) return false;
    var vals = q.options.map(function (o) { return o.v; });
    if (vals.indexOf(v.p) < 0) return false;
    if ((!q.ng || v.p === 'any') && v.ng.length) return false; // 「こだわらない」には NG を付けない
    var seen = {};
    return v.ng.every(function (x) {
      if (seen[x] || x === v.p || x === 'any' || vals.indexOf(x) < 0) return false;
      seen[x] = 1; return true;
    });
  }

  function run(state) {
    var p = state.profile, ans = state.answers || [], seed = state.seed || 1;
    var k = 0;
    var ctx0 = makeCtx(p, {});
    // 次の回答を取り出す。質問idが違う・値が不正なら、そこから先を無効にする
    function take(q, valid) {
      if (k >= ans.length) return null;
      var a = ans[k];
      if (!a || a.id !== q.id || !valid(a.v)) return { invalid: true };
      k++;
      return a;
    }
    function ask(q, stage, index, total) {
      q.progress = { stage: stage, stageName: D.STAGES[stage].name, index: index, total: total };
      return { type: 'question', q: q, answered: k, invalidFrom: k < ans.length ? k : null };
    }

    // ---- 段階0
    var pqs = prefQuestions(ctx0), prefs = {}, ngs = {};
    for (var i = 0; i < pqs.length; i++) {
      var q0 = pqs[i];
      var a0 = take(q0, function (v) { return validPref(q0, v); });
      if (!a0 || a0.invalid) return ask(q0, 0, i + 1, pqs.length);
      prefs[q0.key] = a0.v.p;
      ngs[q0.key] = a0.v.ng.slice();
    }
    var ctx = makeCtx(p, prefs, ngs);
    var items = itemsFor(ctx), ids = items.map(function (it) { return it.id; });
    var IM = itemMap(ctx);
    var st = { comps1: [], comps2: [], count1: {}, count2: {}, indiff: {}, s1raw: [], s2raw: [], tendency: {} };

    // ---- 段階1
    var order = shuffle(ids, rngFor(seed, 's1order'));
    var asked = {}, n1 = Math.min(S.stage1Count, ids.length * (ids.length - 1) / 2);
    var th = fitBT([], ids);
    for (var t = 0; t < n1; t++) {
      // 前回の推定から少しだけ更新する（毎回の再生を軽くするため）
      if (t) th = fitBT(st.comps1, ids, null, th, 40);
      var pair = pickPair(ids, order, th, st.count1, asked, rngFor(seed, 's1pick' + t));
      if (!pair) break;
      var q1 = { kind: 'pair', stage: 1, id: 's1:' + pair[0] + '|' + pair[1],
        a: IM[pair[0]], b: IM[pair[1]], swap: rngFor(seed, 's1swap' + t)() < 0.5 };
      var a1 = take(q1, function (v) { return v === pair[0] || v === pair[1] || v === 'tie' || v === 'none'; });
      if (!a1 || a1.invalid) return ask(q1, 1, t + 1, n1);
      asked[pair[0] < pair[1] ? pair[0] + '|' + pair[1] : pair[1] + '|' + pair[0]] = 1;
      st.count1[pair[0]] = (st.count1[pair[0]] || 0) + 1;
      st.count1[pair[1]] = (st.count1[pair[1]] || 0) + 1;
      var y1 = a1.v === pair[0] ? 1 : a1.v === pair[1] ? 0 : 0.5;
      st.comps1.push({ a: [pair[0]], b: [pair[1]], y: y1 });
      st.s1raw.push({ a: pair[0], b: pair[1], v: a1.v });
      if (a1.v === 'none') { st.indiff[pair[0]] = (st.indiff[pair[0]] || 0) + 1; st.indiff[pair[1]] = (st.indiff[pair[1]] || 0) + 1; }
    }
    var sc1 = stage1Scores(st, ids);

    // ---- 段階2
    var chosen = selectScenarios(ctx, sc1, seed);
    for (var c = 0; c < chosen.length; c++) {
      var cs = chosen[c];
      var q2 = { kind: 'scenario', stage: 2, id: 's2:' + cs.s.id, scenario: cs.s.id,
        aText: cs.t.a, bText: cs.t.b, swap: rngFor(seed, 's2swap' + cs.s.id)() < 0.5,
        visual: cs.s.visual ? { a: panel(cs.s.visual.a, ctx), b: panel(cs.s.visual.b, ctx) } : null };
      var a2 = take(q2, function (v) { return STAGE2_VALUES.indexOf(v) >= 0; });
      if (!a2 || a2.invalid) return ask(q2, 2, c + 1, chosen.length);
      var s = cs.s, y2 = (a2.v + 2) / 4;
      var realA = s.a.plus.filter(function (x) { return x in ITEM_BY_ID; });
      var realB = s.b.plus.filter(function (x) { return x in ITEM_BY_ID; });
      if (realA.length || realB.length) {
        st.comps2.push({ a: s.a.plus, b: s.b.plus, y: y2 });
        realA.concat(realB).forEach(function (id) { st.count2[id] = (st.count2[id] || 0) + 1; });
      }
      var side = a2.v > 0 ? s.a : a2.v < 0 ? s.b : null;
      if (side && side.ideal) Object.keys(side.ideal).forEach(function (id) { st.tendency[id] = side.ideal[id]; });
      st.s2raw.push({ id: s.id, v: a2.v });
    }
    var sc2 = stage2Scores(st, ids);

    // ---- 段階3に進むか
    var qg = { kind: 'gate', stage: 2, id: 'gate' };
    var ag = take(qg, function (v) { return v === 'more' || v === 'finish'; });
    if (!ag || ag.invalid) {
      var r = ask(qg, 2, chosen.length, chosen.length);
      return r;
    }
    var d3 = null, s3ans = [];
    if (ag.v === 'more') {
      var prov = {};
      ids.forEach(function (id) { prov[id] = blend({ s1: sc1[id], s2: sc2[id] }); });
      d3 = designStage3(ctx, prov, seed);
      for (var m = 0; m < d3.design.length; m++) {
        var dq = d3.design[m];
        var rows = d3.items.map(function (id) {
          return { id: id, name: IM[id].name, a: d3.levels[id][dq.A[id]].label, b: d3.levels[id][dq.B[id]].label, diff: dq.vary.indexOf(id) >= 0 };
        });
        var q3 = { kind: 'profile', stage: 3, id: 's3:' + m + ':' + dq.sig, rows: rows, swap: dq.swap, strips: stripsFor(dq.vary, ctx) };
        var a3 = take(q3, function (v) { return v === 'a' || v === 'b' || v === 'tie'; });
        if (!a3 || a3.invalid) return ask(q3, 3, m + 1, d3.design.length);
        s3ans.push({ q: dq, y: a3.v === 'a' ? 1 : a3.v === 'b' ? 0 : 0.5 });
      }
    }

    return {
      type: 'result', answered: k, invalidFrom: k < ans.length ? k : null,
      canMore: ag.v === 'finish',
      result: computeResult(ctx, items, st, sc1, sc2, d3, s3ans),
    };
  }

  // ---------------------------------------------------------------- 結果
  function labelFor(score) {
    for (var i = 0; i < S.labels.length; i++) if (score >= S.labels[i].min) return S.labels[i].name;
    return S.labels[S.labels.length - 1].name;
  }
  function prefIdeal(ctx, key) {
    var pp = prefPair(ctx, key);
    return pp ? pp.pref.ideal : null;
  }

  function computeResult(ctx, items, st, sc1, sc2, d3, s3ans) {
    var sc3 = {}, ideal3 = {};
    if (d3 && s3ans.length) {
      var u = fitStage3(d3, s3ans);
      d3.items.forEach(function (id) {
        var arr = u[id], mx = -Infinity, mn = Infinity, best = 0;
        arr.forEach(function (x, i) { if (x > mx) { mx = x; best = i; } if (x < mn) mn = x; });
        var range = mx - mn;
        sc3[id] = sigmoid(1.6 * (range - 1.0));
        // 良し悪しに順番がある水準（data.js の levels が配列：左ほど良い）は、いちばん良い水準のときだけ「理想」にする。
        // 答えがぶれたときに「理想：浪費気味」「理想：会話が続きにくい」のような結果を出さないため（2026-11-10）
        var ordered = ITEM_BY_ID[id] && Array.isArray(ITEM_BY_ID[id].levels);
        if (range >= 0.4 && (!ordered || best === 0)) ideal3[id] = d3.levels[id][best];
      });
    }
    // 段階0の NG を、質問ごと（結果の「絶対NG」欄）と項目ごと（重視度・理想）にまとめる
    var ngByItem = {}, ngList = [];
    D.PREFS.forEach(function (pq) {
      var key = pq.key, list = ctx.ngs[key], id = PREF_ITEM[key];
      if (!list || !list.length) return;
      var opts = prefOptions(pq, ctx);
      var labs = list.map(function (v) {
        var o = opts.filter(function (x) { return x.v === v; })[0];
        return o ? (o.ngLabel || String(o.label).split('：')[0]) : v;
      });
      ngList.push({ key: key, name: pq.ngName || pq.label, text: labs.join('・') });
      if (!id) return;
      ngByItem[id] = ngByItem[id] || [];
      labs.forEach(function (l) { if (ngByItem[id].indexOf(l) < 0) ngByItem[id].push(l); });
    });
    var list = items.map(function (it) {
      var parts = { s1: sc1[it.id], s2: sc2[it.id], s3: sc3[it.id] };
      var score = blend(parts);
      // 段階3だけで重視度が跳ね上がらないようにする（段階1・2の結果から上げてよい幅に上限）
      var base12 = (parts.s1 != null || parts.s2 != null) ? blend({ s1: parts.s1, s2: parts.s2 }) : null;
      if (parts.s3 != null && base12 != null) score = Math.min(score, base12 + S.stage3MaxLift);
      var ng = ngByItem[it.id] || null;
      // 「本当にダメ」がある項目は、少なくとも「やや重視」にする
      if (ng) score = Math.max(Math.min(1, score + S.ngBoost), S.ngFloor);
      var label = labelFor(score);
      var pi = it.pref ? prefIdeal(ctx, it.pref) : null;
      var ngText = ng ? 'NG：' + ng.join('・') : '';
      var ideal, short;
      if (S.lowLabels.indexOf(label) >= 0) {
        ideal = short = 'こだわりなし' + (pi ? '（強いて言えば' + pi + '）' : '');
      } else if (ideal3[it.id] && (base12 == null || base12 >= S.stage3IdealMin)) {
        ideal = ideal3[it.id].label; short = ideal3[it.id].short;
      } else if (pi && it.prefAsNote) {
        // 段階0の好みが、項目そのものとは別の軸のとき（顔面偏差値と顔のタイプなど）は、好みを添え書きにする
        ideal = short = expand(it.ideal, ctx, null, { noDiff: true }) + '（' + it.prefAsNote + '：' + pi + '）';
      } else if (pi) {
        // NG がなければ「できれば」。NG があれば NG を併記する
        ideal = short = ng ? pi : 'できれば' + pi;
      } else if (st.tendency[it.id]) {
        ideal = short = st.tendency[it.id];
      } else {
        ideal = short = expand(it.ideal, ctx, null, { noDiff: true }) || it.ideal;
      }
      if (ng) { ideal += '（' + ngText + '）'; short += '（' + ngText + '）'; }
      return { id: it.id, name: it.name, desc: it.desc, score: score, label: label, ideal: ideal, short: short, parts: parts, ng: ng };
    });
    list.sort(function (a, b) { return b.score - a.score; });
    var top3 = list.slice(0, 3).map(function (x) { return { id: x.id, name: x.name, text: x.short }; });
    return { items: list, top3: top3, ngs: ngList, gaps: findGaps(list, st), didStage3: !!(d3 && s3ans.length), R: ctx.R, partnerAge: ctx.partnerAge };
  }

  // 建前（段階1）と本音（段階2・3）のズレ
  function findGaps(list, st) {
    var both = list.filter(function (x) { return x.parts.s1 != null && (x.parts.s2 != null || x.parts.s3 != null); });
    if (both.length < 5) return [];
    function honne(x) {
      var w = S.weights, s = 0, t = 0;
      if (x.parts.s2 != null) { s += w.s2 * x.parts.s2; t += w.s2; }
      if (x.parts.s3 != null) { s += w.s3 * x.parts.s3; t += w.s3; }
      return s / t;
    }
    var r1 = both.slice().sort(function (a, b) { return b.parts.s1 - a.parts.s1; });
    var r2 = both.slice().sort(function (a, b) { return honne(b) - honne(a); });
    var n = both.length, out = [];
    both.forEach(function (x) {
      var p1 = r1.indexOf(x), p2 = r2.indexOf(x);
      var diff = (p1 - p2) / (n - 1); // 正：本音のほうが上
      if (Math.abs(diff) < 0.35) return;
      out.push({ x: x, diff: diff, p1: p1, p2: p2 });
    });
    out.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    return out.slice(0, 2).map(function (g) {
      var x = g.x, msg = null;
      // 段階1で、この項目と反対の答えをした比較を探す
      for (var i = 0; i < st.s1raw.length && !msg; i++) {
        var r = st.s1raw[i];
        if (r.a !== x.id && r.b !== x.id) continue;
        var other = r.a === x.id ? r.b : r.a;
        var o = both.filter(function (y) { return y.id === other; })[0];
        if (!o) continue;
        var po = r2.indexOf(o);
        if (g.diff > 0 && r.v === other && po > g.p2) {
          msg = '『' + x.name + 'より' + o.name + '』と答えていましたが、具体的な場面では' + x.name + 'を優先する傾向があります。';
        } else if (g.diff < 0 && r.v === x.id && po < g.p2) {
          msg = '『' + o.name + 'より' + x.name + '』と答えていましたが、具体的な場面では' + o.name + 'を優先する傾向があります。';
        }
      }
      if (!msg) {
        msg = g.diff > 0
          ? '項目名だけで比べると「' + x.name + '」の順位は低めでしたが、具体的な場面では優先する傾向があります。'
          : '項目名だけで比べると「' + x.name + '」を重視していましたが、具体的な場面では思ったほど優先していません。';
      }
      return { id: x.id, name: x.name, up: g.diff > 0, text: msg };
    });
  }

  return {
    validateProfile: validateProfile, run: run, makeCtx: makeCtx, validPref: validPref, resolve: resolve, avgIncome: avgIncome,
    partnerAgeFor: partnerAgeFor, prefQuestions: prefQuestions, prefPair: prefPair, expand: expand,
    scenarioTexts: scenarioTexts, itemsFor: itemsFor, itemLevels: itemLevels, incomeValue: incomeValue,
    STAGE2_VALUES: STAGE2_VALUES, _internal: { fitBT: fitBT, shuffle: shuffle, rngFor: rngFor },
  };
});
