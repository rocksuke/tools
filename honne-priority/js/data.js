/*
 * 診断データ（文言・数値はここだけ編集すれば反映されます）
 *
 * ■ シナリオの書き方
 *   {年収×1.5}      … 相手の同年代平均年収 R ×1.5 を50万円単位に丸めて「年収750万円（あなた＋200万）」と表示
 *   {年収×0.6〜2.0} … 「年収300万〜1000万円」のような幅で表示
 *   {貯金×1.0}      … R×倍率を「500万円」と表示（直前に「貯金」と書く）
 *   〔好みの体型〕〔好みでない体型〕 … 段階0の回答を差し込む。使える名前は PREFS の label
 *   〔考えが一致〕〔考えが違う〕     … シナリオの about に書いた段階0の質問（kids / my_work / wife_work）の回答から生成
 *   〔大きく年下〕                   … 自分−5〜−8歳のうち、相手が20歳以上に収まる最大の差
 *   〔 〕が展開できないとき（「こだわらない」と答えた、年齢・身長が範囲外など）は、そのシナリオを出題しません。
 *
 * ■ plus … そのシナリオで「その人を選ぶ理由」になる項目id（ITEMS の id）。
 *          '_overall' は「条件全般」を表す仮想項目（重視度は計算しない）。
 * ■ ideal … その人が選ばれたとき、結果の「理想」欄に出す傾向の文言（任意）。
 * ■ visual … 参考画像。{ a: ['looks', 0], b: ['looks', 1] } のように、A・B それぞれに STRIPS の画像と
 *            何番目のコマ（0＝左）を出すかを書く。'pref:body' / 'anti:body' と書くと、段階0で選んだ好み／
 *            好みでない選択肢のコマを出す（画像のコマの並びは段階0の選択肢の並びと同じ）。ファイルがなければ表示しない。
 * ■ variants … [{ when: { smoker: true }, a: {...}, b: {...} }] のように、自分の喫煙・飲酒に応じて A・B を差し替える。
 * ■ cond  … 出題条件。purpose（'婚活'/'恋活'）、minAge / maxAge（自分の年齢）。
 * ■ target … '共通' / '男性'（相手が男性のときだけ）/ '女性'（相手が女性のときだけ）
 * ■ adult  … true なら、基本情報で「性生活の質問を含める」を選んだ人だけに出す（PREFS・ITEMS・SCENARIOS 共通）
 */
(function (root) {
  'use strict';

  var DATA = {};

  DATA.SETTINGS = {
    ageMin: 20,
    ageMax: 65,
    partnerHeightRange: { 男性: [155, 195], 女性: [145, 180] },
    avgHeight: { 男性: 171, 女性: 158 }, // 段階3の身長の水準が5つになるとき、平均から最も遠い水準を外す
    maxLevels: 4,              // 段階3で1項目に使う水準の最大数
    incomeFloorFullTime: 250,  // フルタイム勤務の年収の下限（万円）
    incomeLevelFloor: 200,     // 段階3の年収水準の下限（万円）
    antiAgeGap: 5,             // 〔好みでない年齢〕の年齢差
    bigYoungerGaps: [8, 7, 6, 5], // 〔大きく年下〕で試す年齢差（大きい順）
    stage1Count: 22,
    stage2Count: 15,
    stage3Count: 12,
    stage3Items: 4,
    weights: { s1: 0.4, s2: 0.3, s3: 0.3 },
    // 重視度ラベル（スコア0〜1。上から順に判定）
    labels: [
      { min: 0.80, name: '絶対条件' },
      { min: 0.64, name: 'かなり重視' },
      { min: 0.48, name: 'やや重視' },
      { min: 0.32, name: 'あまり気にしない' },
      { min: -1, name: '気にしない' },
    ],
    lowLabels: ['あまり気にしない', '気にしない'], // この重視度なら「理想」は「こだわりなし」
    ngBoost: 0.1,  // 段階0で NG を選んだ項目の重視度に足す値
    ngFloor: 0.48, // 段階0で NG を選んだ項目の重視度の下限（やや重視）
    // 段階3（任意・12問）は答えがぶれやすいので、段階1・2だけの重視度より上げてよい幅に上限を付ける（2026-11-10）。
    // 段階3の「理想の水準」は、段階1・2で「やや重視」以上の項目にだけ使う
    stage3MaxLift: 0.12,
    stage3IdealMin: 0.48,
    anyLabel: 'こだわらない',
  };

  DATA.STAGES = [
    { id: 0, name: '段階0：好みのタイプ' },
    { id: 1, name: '段階1：ざっくり比較' },
    { id: 2, name: '段階2：トレードオフ比較' },
    { id: 3, name: '段階3：条件付き比較' },
  ];

  /*
   * 年収テーブル（万円）
   * 厚生労働省「賃金構造基本統計調査」（東京都・令和2年）一般労働者の年収を、
   * 近年の賃上げ率で約12%補正した2026年の概算値。
   */
  DATA.INCOME_TABLE = [
    { min: 20, max: 24, 男性: 370, 女性: 350 },
    { min: 25, max: 29, 男性: 500, 女性: 450 },
    { min: 30, max: 34, 男性: 610, 女性: 510 },
    { min: 35, max: 39, 男性: 730, 女性: 560 },
    { min: 40, max: 44, 男性: 800, 女性: 590 },
    { min: 45, max: 49, 男性: 860, 女性: 600 },
    { min: 50, max: 54, 男性: 950, 女性: 600 },
    { min: 55, max: 59, 男性: 970, 女性: 610 },
    { min: 60, max: 65, 男性: 660, 女性: 460 },
  ];

  // 段階0の年齢の選択肢（off＝想定相手年齢の差、lo〜hi＝表示する範囲）
  DATA.AGE_OPTIONS = [
    { v: '年上', label: '年上', off: 4, lo: 3, hi: 6 },
    { v: '同年代', label: '同年代', off: 0, lo: -2, hi: 2 },
    { v: '年下', label: '年下', off: -4, lo: -6, hi: -3 },
  ];

  // 身長の差の区分（段階0の選択肢と段階3の水準で共通）。d＝代表値の差、lo〜hi＝範囲（null は上限・下限なし）
  // 相手の身長の範囲（partnerHeightRange）に入らない区分は表示しない。
  DATA.HEIGHT_OPTIONS = [
    { v: '高い', label: '高い（15cm以上）', rel: '自分＋15cm以上', d: 18, lo: 15, hi: null },
    { v: 'やや高い', label: 'やや高い（5〜14cm）', rel: '自分＋5〜14cm', d: 9, lo: 5, hi: 14 },
    { v: '同じくらい', label: '同じくらい（±4cm）', rel: '自分±4cm', d: 0, lo: -4, hi: 4 },
    { v: 'やや低い', label: 'やや低い（5〜14cm）', rel: '自分−5〜14cm', d: -9, lo: -14, hi: -5 },
    { v: '低い', label: '低い（15cm以上）', rel: '自分−15cm以上', d: -18, lo: null, hi: -15 },
  ];

  /*
   * 段階0：好みのタイプ
   *  options の各要素：v（保存する値）, label（ボタン）, text（〔 〕に差し込む文言）,
   *                   ideal（結果の「理想」欄）, agree / disagree（〔考えが一致〕〔考えが違う〕）
   *  order: 'linear' … 〔好みでない〕は配列の反対側の端。 opposite を書くとそちらを優先。
 *  image：参考画像（選択肢を左から順に並べた1枚）。相手の性別ごとに書ける。ファイルがなければ表示しない。
   *  「こだわらない」は自動で末尾に追加されます。
 *  好みを選んだあと「逆に絶対NGは？」を同じ画面で聞く（複数選択可）。noNg: true の質問では聞かない。
 *  ngName（結果の「絶対NG」欄の見出し。なければ label）、選択肢の ngLabel（NG として表示する文言。なければ label）。
 *  NG はその質問に対応する項目（item、なければ ITEMS の pref から）の重視度と「理想」欄に反映し、
 *  〔好みでない◯◯〕には NG の選択肢を使わない。
   */
  DATA.PREFS = [
    {
      key: 'body', label: '体型', target: '共通', q: '好きな体型は？',
      image: { 男性: 'img/body_male.jpg', 女性: 'img/body_female.jpg' },
      options: {
        男性: [
          { v: '細身', text: '細身の体型' },
          { v: '標準', text: '標準的な体型' },
          { v: '筋肉質', text: '筋肉質な体型' },
          { v: 'がっしり・ぽっちゃり', text: 'がっしり・ぽっちゃりした体型' },
        ],
        女性: [
          { v: '細身', text: '細身の体型' },
          { v: '標準', text: '標準的な体型' },
          { v: 'グラマー', text: 'グラマーな体型' },
          { v: 'ぽっちゃり', text: 'ぽっちゃりした体型' },
        ],
      },
    },
    { key: 'height', label: '身長', target: '共通', q: '相手の身長は、自分と比べて？', compute: 'height' },
    { key: 'age', label: '年齢', target: '共通', q: '相手の年齢は？', compute: 'age' },
    {
      key: 'face_type', label: '顔のタイプ', target: '共通', item: 'looks', q: '顔のタイプは？',
      image: { 男性: 'img/face_male.jpg', 女性: 'img/face_female.jpg' },
      options: {
        男性: [
          { v: '塩顔', text: '顔は塩顔タイプ' },
          { v: '濃い顔', text: '顔は濃い顔タイプ' },
          { v: 'かわいい系', text: '顔はかわいい系' },
        ],
        女性: [
          { v: 'かわいい系', text: '顔はかわいい系' },
          { v: '綺麗系', text: '顔は綺麗系' },
          { v: '親しみやすい系', text: '顔は親しみやすい系' },
        ],
      },
      opposite: { 塩顔: '濃い顔', 濃い顔: '塩顔', かわいい系: '濃い顔|綺麗系', 綺麗系: 'かわいい系', 親しみやすい系: '綺麗系' },
    },
    {
      key: 'animal_face', label: '動物顔', target: '共通', q: '動物に例えると、好きな顔は？',
      image: { 男性: 'img/animal_male.jpg', 女性: 'img/animal_female.jpg' },
      options: [
        { v: 'イヌ顔', text: '人懐っこいイヌ顔', ideal: 'イヌ顔の人' },
        { v: 'タヌキ顔', text: '丸くて愛嬌のあるタヌキ顔', ideal: 'タヌキ顔の人' },
        { v: 'ネコ顔', text: '目元がシャープなネコ顔', ideal: 'ネコ顔の人' },
        { v: 'ウサギ顔', text: '目がくりっとしたウサギ顔', ideal: 'ウサギ顔の人' },
        { v: 'ウマ顔', text: '面長で落ち着いたウマ顔', ideal: 'ウマ顔の人' },
      ],
      opposite: { イヌ顔: 'ネコ顔', ネコ顔: 'イヌ顔', タヌキ顔: 'ウマ顔', ウサギ顔: 'ウマ顔', ウマ顔: 'タヌキ顔' },
    },
    {
      key: 'fashion', label: 'ファッション', target: '共通', q: '好きなファッションの系統は？',
      image: { 男性: 'img/style_male.jpg', 女性: 'img/style_female.jpg' },
      options: {
        男性: [
          { v: 'キレイめカジュアル', text: 'キレイめカジュアル系' },
          { v: 'アメカジ', text: 'アメカジ系' },
          { v: 'ミニマル', text: 'シンプルなミニマル系' },
          { v: 'トラッド', text: 'きちんとしたトラッド系' },
          { v: 'スポーティー', text: 'スポーティー系' },
        ],
        女性: [
          { v: 'キレイめカジュアル', text: 'キレイめカジュアル系' },
          { v: 'フェミニン', text: 'フェミニン系' },
          { v: 'ナチュラル', text: 'ナチュラル系' },
          { v: 'モード', text: 'シンプルなモード系' },
          { v: 'スポーティー', text: 'スポーティー系' },
        ],
      },
      opposite: { キレイめカジュアル: 'スポーティー', アメカジ: 'ミニマル', ミニマル: 'アメカジ', トラッド: 'スポーティー',
        スポーティー: 'トラッド|フェミニン', フェミニン: 'モード', ナチュラル: 'モード', モード: 'フェミニン' },
    },
    {
      key: 'lead', label: '関係性', target: '共通', q: '2人の関係性は？',
      options: [
        { v: '引っ張ってほしい', text: 'あなたを引っ張ってくれる関係', ideal: '引っ張ってくれる人', ngLabel: '相手が引っ張る関係' },
        { v: '対等に相談したい', text: '何でも対等に相談し合える関係', ideal: '対等に相談できる人', ngLabel: '対等な関係' },
        { v: '自分が引っ張りたい', text: 'あなたがリードする関係', ideal: 'こちらがリードできる人', ngLabel: '自分が引っ張る関係' },
      ],
      opposite: { 引っ張ってほしい: '自分が引っ張りたい', 対等に相談したい: '引っ張ってほしい', 自分が引っ張りたい: '引っ張ってほしい' },
    },
    {
      key: 'holiday', label: '休日の過ごし方', target: '共通', item: 'hobby', q: '休日の過ごし方は？',
      options: [
        { v: 'アウトドア・活動的', text: 'アウトドアで活動的' },
        { v: 'インドア・まったり', text: 'インドアでまったり' },
      ],
    },
    {
      key: 'social', label: '社交性', target: '共通', q: '相手の社交性は？',
      options: [
        { v: '友人が多く社交的', text: '友人が多く社交的な人', ideal: '友人が多く社交的な人' },
        { v: '落ち着いていて少人数派', text: '落ち着いていて少人数派の人', ideal: '落ち着いた少人数派の人' },
      ],
    },
    {
      key: 'contact', label: '連絡頻度', target: '共通', q: '連絡の頻度は？',
      options: [
        { v: '毎日こまめに', text: '毎日こまめにくれる', ideal: '毎日こまめに連絡をくれる人' },
        { v: '必要なときだけ', text: '必要なときだけ', ideal: '連絡は必要なときだけの人' },
      ],
    },
    {
      key: 'drink', label: '飲酒スタイル', ngName: 'お酒', target: '共通', q: '相手のお酒は？',
      options: [
        { v: '一緒に飲める人がいい', text: '一緒に楽しく飲める', ideal: '一緒にお酒を楽しめる人', ngLabel: '飲む人' },
        { v: '飲まない人がいい', text: 'まったく飲まない', ideal: 'お酒を飲まない人', ngLabel: '飲まない人' },
      ],
    },
    {
      key: 'area', label: '住環境', target: '共通', q: '住みたい環境は？',
      options: [
        { v: '都心（23区内）', text: '都心（23区内）', ideal: '都心（23区内）に住みたい人' },
        { v: '郊外（多摩・神奈川・埼玉・千葉）', text: '郊外（多摩・神奈川・埼玉・千葉）', ideal: '郊外に住みたい人' },
        { v: '完全フルリモート', label: '完全フルリモート（首都圏にこだわらない）', text: 'フルリモートで首都圏にこだわらない場所',
          ideal: 'フルリモートで住む場所にこだわらない人' },
      ],
      opposite: { '都心（23区内）': '完全フルリモート', '郊外（多摩・神奈川・埼玉・千葉）': '都心（23区内）', 完全フルリモート: '都心（23区内）' },
    },
    {
      key: 'kids', label: '子ども', target: '共通', q: '自分は子どもが欲しい？',
      options: [
        { v: '欲しい', ideal: '子どもが欲しいと考えている人',
          agree: '「子どもが欲しい」とあなたと同じ考え', disagree: '「子どもは持たなくていい」と考えている' },
        { v: 'どちらでも', ideal: '子どもについて柔軟な人' },
        { v: '欲しくない', ideal: '子どもを持たない考えの人',
          agree: '「子どもは持たない」とあなたと同じ考え', disagree: '「子どもが欲しい」と強く考えている' },
      ],
      noAny: true, // 「どちらでも」があるので「こだわらない」は付けない
      noNg: true,  // 自分の希望なので NG は聞かない
    },
    {
      key: 'my_work', label: 'あなたの働き方', target: '男性', noNg: true, q: '結婚後の自分の働き方は？',
      options: [
        { v: '専業主婦', label: '専業主婦（主夫）', ideal: '専業で家庭に入ることに賛成の人',
          agree: '「家庭に入ってほしい」とあなたと同じ考え', disagree: '「フルタイムで働き続けてほしい」と考えている' },
        { v: 'パート', ideal: 'パート勤務に賛成の人',
          agree: '「パートくらいがちょうどいい」とあなたと同じ考え', disagree: '「フルタイムで働き続けてほしい」と考えている' },
        { v: 'フルタイム共働き', ideal: 'フルタイム共働きを望む人',
          agree: '「共働きでいこう」とあなたと同じ考え', disagree: '「家庭に入ってほしい」と考えている' },
      ],
    },
    {
      key: 'wife_work', label: '相手の働き方', ngName: '結婚後の働き方', target: '女性', q: '結婚後、相手にどう働いてほしい？',
      options: [
        { v: '専業主婦', ideal: '専業主婦を希望する人',
          agree: '「結婚したら家庭に入りたい」とあなたと同じ考え', disagree: '「結婚後もフルタイムで働きたい」と考えている' },
        { v: 'パート', ideal: 'パート勤務を希望する人',
          agree: '「パートで働きたい」とあなたと同じ考え', disagree: '「結婚後もフルタイムで働きたい」と考えている' },
        { v: 'フルタイム共働き', ideal: 'フルタイム共働きを希望する人',
          agree: '「結婚後もフルタイムで働きたい」とあなたと同じ考え', disagree: '「結婚したら家庭に入りたい」と考えている' },
      ],
    },
    {
      key: 'bust', label: '胸の大きさ', target: '女性', adult: true, q: '胸の大きさの好みは？',
      options: [
        { v: '大きめ', text: '大きめ' },
        { v: '普通', text: '普通くらい' },
        { v: '控えめ', text: '控えめ' },
      ],
    },
    {
      key: 'makeup', label: 'スタイル', ngName: 'メイク・ファッション', target: '女性', q: 'メイク・ファッションは？',
      image: { 女性: 'img/makeup_female.jpg' },
      options: [
        { v: '華やか', text: '華やか' },
        { v: 'ナチュラル', text: 'ナチュラル' },
      ],
    },
  ];

  // 性生活（大人の話）の質問を含める人だけに出す（adult: true）
  DATA.PREFS.push({
    key: 'sex_freq', label: '頻度', ngName: '性生活の頻度', target: '共通', adult: true, q: '性生活の頻度の理想は？',
    options: [
      { v: '週2回以上', text: '週2回以上', ideal: '週2回以上を望む人' },
      { v: '週1回くらい', text: '週1回くらい', ideal: '週1回くらいを望む人' },
      { v: '月2〜3回', text: '月2〜3回', ideal: '月2〜3回くらいを望む人' },
      { v: '月1回以下でいい', text: '月1回以下', ideal: '頻度は少なめでいい人' },
    ],
  });

  /*
   * 項目マスター
   *  levels：段階3の水準（良いとされる順）。'income' / 'height' / 'age' / 'body' は算出ルールで生成。
 *          { pref: 'fashion' } と書くと、段階0の好み・好みでない選択肢などから3つを水準にする
   *  pref  ：結果の「理想」に使う段階0の質問
   *  ideal ：段階0・段階3で理想が決まらなかったときの「理想」の文言（{年収×k} も使える）
   *  purpose：'婚活' と書くと婚活の人だけに出す
 *  variants：基本情報（自分の喫煙・飲酒）に応じて、名前・水準などを差し替える。
 *            when: { smoker: true }（自分が吸う）/ { drinker: true }（自分が飲む）
   */
  DATA.ITEMS = [
    // ---- 共通
    { id: 'income', name: '年収', target: '共通', levels: 'income', ideal: '{年収×1.2}以上',
      desc: '相手の収入の高さ' },
    { id: 'height', name: '身長', target: '共通', levels: 'height', pref: 'height', ideal: '好みの身長であること',
      desc: '相手の身長' },
    { id: 'age', name: '年齢差', target: '共通', levels: 'age', pref: 'age', ideal: '好みの年齢であること',
      desc: '自分との年齢差' },
    { id: 'looks', name: '顔面偏差値', target: '共通', levels: ['顔立ちが整っている', '普通', '顔立ちは好みから遠い'],
      pref: 'animal_face', prefAsNote: '好みの顔', ideal: '顔面偏差値が高い人', desc: '顔立ちの整い具合' },
    { id: 'body', name: '体型', target: '共通', levels: 'body', pref: 'body', ideal: '好みの体型であること',
      desc: '体型が自分の好みかどうか' },
    { id: 'fashion', name: 'ファッションの系統', target: '共通', levels: { pref: 'fashion' }, pref: 'fashion',
      ideal: '好みのファッションの人', desc: '服装の系統が好みかどうか' },
    { id: 'cleanliness', name: '清潔感・身だしなみ', target: '共通', levels: ['気を遣っている', '普通', '無頓着'],
      ideal: '清潔感があり身だしなみに気を遣う人', desc: '服装・髪型・におい・肌など' },
    { id: 'personality', name: '性格の相性', target: '共通', levels: ['とても合う', '普通', '時々ぶつかる'],
      ideal: '性格がとても合う人', desc: '価値観や性格が合うかどうか' },
    { id: 'conversation', name: '会話・笑いのツボ', target: '共通', levels: ['一緒にいて一番楽しい', '普通', '会話が続きにくい'],
      ideal: '一緒にいて一番楽しい人', desc: '話していて楽しいか、笑いのツボが合うか' },
    { id: 'money', name: '金銭感覚', target: '共通', levels: ['堅実・貯金あり', '普通', '浪費気味・貯金なし'],
      ideal: '堅実で貯金がある人', desc: 'お金の使い方・貯め方' },
    { id: 'job_stability', name: '仕事の安定性', target: '共通', levels: ['公務員・大企業', '中小企業', '自営業・フリーランス'],
      ideal: '安定した仕事に就いている人', desc: '勤め先や雇用の安定' },
    { id: 'workstyle', name: '働き方（時間）', target: '共通', levels: ['定時・土日休み・リモート可', '普通', '激務・休日出勤あり'],
      ideal: '定時で帰れて休みがしっかりある人', desc: '帰宅時間や休日の取りやすさ' },
    { id: 'education', name: '学歴', target: '共通', levels: ['難関大卒', '大卒', '高卒・専門卒'],
      ideal: '学歴が高い人', desc: '最終学歴' },
    { id: 'distance', name: '住んでいる場所', target: '共通', levels: ['同じ沿線で30分以内', '片道1時間', '片道1時間半以上'],
      ideal: '同じ沿線で30分以内', desc: '今住んでいる場所までの距離' },
    { id: 'children', name: '子どもの希望', target: '共通', levels: ['欲しい', 'どちらでも', '欲しくない'],
      pref: 'kids', ideal: '子どもについての考えが同じ人', desc: '子どもを持つかどうかの考え' },
    { id: 'housework', name: '家事への姿勢', target: '共通', levels: ['積極的', '半分程度', 'ほぼしない'],
      ideal: '家事に積極的な人', desc: '家事をどれくらい担うか' },
    { id: 'smoking', name: '喫煙', target: '共通', levels: ['吸わない', '加熱式のみ', '紙タバコを吸う'],
      ideal: '吸わない人', desc: '相手がタバコを吸うかどうか',
      variants: [{ when: { smoker: true }, name: '喫煙への理解', levels: ['一緒に吸える・気にしない', '外で吸えばOK', '禁煙してほしい'],
        ideal: 'あなたの喫煙に理解がある人', desc: 'あなたがタバコを吸うことに寛容か' }] },
    { id: 'drinking', name: '飲酒', target: '共通', levels: ['飲まない', '付き合い程度', '毎晩飲む'],
      pref: 'drink', ideal: 'お酒の付き合い方が合う人', desc: '相手のお酒の飲み方',
      variants: [{ when: { drinker: true }, name: 'お酒への理解', levels: ['一緒に飲める', '飲まないが理解がある', 'お酒に否定的'],
        ideal: 'あなたの飲酒に理解がある人', desc: '一緒に飲めるか、あなたの飲酒に寛容か' }] },
    { id: 'hobby', name: '趣味の一致', target: '共通', levels: ['完全に一致', '一部一致', 'まったく違う'],
      ideal: '趣味が合う人', desc: '趣味や休日の過ごし方が合うか' },
    { id: 'family', name: '実家との関係', target: '共通', levels: ['適度な距離', '頻繁に行き来', '同居の可能性あり'],
      ideal: '実家と適度な距離感の人', desc: '相手と実家との距離感' },
    { id: 'relocation', name: '転勤', target: '共通', levels: ['なし', '都内・近郊のみ', '全国転勤あり'],
      ideal: '転勤のない人', desc: '転勤の有無と範囲' },
    { id: 'marriage_history', name: '結婚歴', target: '共通', levels: ['初婚', '離婚歴あり（子なし）', '離婚歴あり（子あり）'],
      ideal: '初婚の人', desc: '過去の結婚歴' },
    { id: 'leadership', name: 'リード力', target: '共通', levels: ['引っ張ってくれる', '対等に相談', 'こちらがリードする'],
      pref: 'lead', ideal: '関係性の好みが合う人', desc: 'どちらが引っ張る関係か' },
    { id: 'sincerity', name: '誠実さ', target: '共通', levels: ['とても誠実', '普通', '軽いところがある'],
      ideal: '誠実で信頼できる人', desc: '嘘をつかない、浮気をしないなど' },
    { id: 'affection', name: '愛情表現・一緒の時間', target: '共通', levels: ['愛情表現が豊か', '普通', '愛情表現は少なめ'],
      ideal: '愛情表現が豊かで一緒の時間を大切にする人', desc: '気持ちを伝えてくれるか、一緒に過ごしてくれるか' },
    { id: 'contact', name: '連絡頻度', target: '共通', levels: ['毎日こまめに', '数日に1回', '必要なときだけ'],
      pref: 'contact', ideal: '連絡のペースが合う人', desc: 'LINEなどの連絡の頻度' },
    { id: 'social', name: '社交性', target: '共通', levels: ['社交的で友人が多い', '普通', '少人数派'],
      pref: 'social', ideal: '社交性のタイプが合う人', desc: '友人の多さ・人付き合いのスタイル' },
    { id: 'area', name: '住環境', target: '共通', levels: ['都心（23区内）', '23区外の都内', '神奈川・埼玉・千葉', 'フルリモートで地方'],
      pref: 'area', ideal: '住みたい環境が同じ人', desc: '結婚・同棲後に住みたい場所' },
    { id: 'marriage_timing', name: '結婚の時期', target: '共通', purpose: '婚活', levels: ['1年以内', '2〜3年以内', '時期は未定'],
      ideal: '早めに結婚したいと考えている人', desc: 'いつ頃結婚したいと考えているか' },
    { id: 'sex_compat', name: '体の相性', target: '共通', adult: true, levels: ['とても合う', '普通', 'あまり合わない'],
      ideal: '体の相性が良い人', desc: '性生活での相性' },
    { id: 'sex_freq', name: '性生活の頻度', target: '共通', adult: true, levels: ['理想とぴったり', '少しずれる', '大きくずれる'],
      pref: 'sex_freq', ideal: '求める頻度が合う人', desc: '性生活の頻度の考えが合うか' },

    // ---- 相手が男性のとき
    { id: 'eldest_son', name: '長男かどうか', target: '男性', levels: ['次男以下', '長男（同居なし）', '長男（将来同居の可能性）'],
      ideal: '同居の可能性がない人', desc: '家を継ぐ・同居の可能性' },
    { id: 'wife_work', name: '妻の働き方への考え', target: '男性', levels: ['共働き前提', 'どちらでも', '専業主婦でいてほしい'],
      pref: 'my_work', ideal: 'あなたの働き方に賛成の人', desc: '結婚後のあなたの働き方についての考え' },
    { id: 'hair', name: '髪のボリューム', target: '男性', levels: ['髪のボリュームあり', '少し気になる', '髪のボリュームが少ない'],
      ideal: '髪のボリュームがある人', desc: '髪のボリューム' },
    { id: 'parenting', name: '育児参加', target: '男性', levels: ['半分以上担う', '手伝う程度', 'ほぼ妻任せ'],
      ideal: '育児を半分以上担う人', desc: '子育てにどれくらい関わるか' },

    // ---- 相手が女性のとき
    { id: 'career', name: '結婚後の働き方', target: '女性', levels: ['フルタイム共働き', 'パート', '専業主婦希望'],
      pref: 'wife_work', ideal: '働き方の希望が合う人', desc: '結婚後に相手がどう働きたいか' },
    { id: 'bust', name: '胸の大きさ', target: '女性', adult: true, levels: ['大きめ', '普通', '控えめ'],
      pref: 'bust', ideal: '好みの胸の大きさであること', desc: 'バストのサイズ感' },
    { id: 'makeup', name: 'メイク・ファッション', target: '女性', levels: ['華やか', 'ナチュラル', 'すっぴん中心'],
      pref: 'makeup', ideal: '好みのメイク・ファッションの人', desc: 'メイクや服装の雰囲気' },
    { id: 'beauty_cost', name: '美容・服飾費', target: '女性', levels: ['月1万未満', '月2万程度', '月5万以上'],
      ideal: '美容・服飾費が控えめな人', desc: '美容院・ネイル・服などにかけるお金' },
    { id: 'cooking', name: '料理', target: '女性', levels: ['毎日手作り', '時々', 'ほぼしない'],
      ideal: '料理をよくする人', desc: '料理をする頻度' },
  ];

  /*
   * 参考画像（3段階を左から並べた横長16:9の1枚）。段階2のシナリオ（visual）と段階3の比較表で使う。
   *  item … 段階3でこの項目の水準を比べるときに、表の上に表示する
   *  box  … 1コマを切り出して表示するときの縦横比、y … 切り出す縦位置
   */
  DATA.STRIPS = {
    looks: { item: 'looks', 男性: 'img/looks_male.jpg', 女性: 'img/looks_female.jpg',
      labels: ['顔立ちが整っている', '普通', '顔立ちは好みから遠い'], box: '3 / 4', y: '0%' },
    clean: { item: 'cleanliness', 男性: 'img/clean_male.jpg', 女性: 'img/clean_female.jpg',
      labels: ['清潔感あり', '普通', '無頓着'], box: '458 / 768', y: '0%' },
    figure: { 男性: 'img/figure_male.jpg', 女性: 'img/figure_female.jpg',
      labels: ['スタイル抜群', '普通', '体型は好みから遠い'], box: '458 / 768', y: '0%' },
    hair: { item: 'hair', 男性: 'img/hair_male.jpg',
      labels: ['髪のボリュームあり', '少し気になる', '髪のボリュームが少ない'], box: '3 / 4', y: '0%' },
    // 段階0の画像（コマは選択肢と同じ並び。'pref:〜' / 'anti:〜' で使う）
    body: { 男性: 'img/body_male.jpg', 女性: 'img/body_female.jpg', box: '344 / 768', y: '0%' },
    face: { 男性: 'img/face_male.jpg', 女性: 'img/face_female.jpg', box: '3 / 4', y: '0%' },
    animal: { 男性: 'img/animal_male.jpg', 女性: 'img/animal_female.jpg', box: '3 / 4', y: '20%' },
    makeup: { 女性: 'img/makeup_female.jpg', box: '688 / 768', y: '0%' },
    style: { 男性: 'img/style_male.jpg', 女性: 'img/style_female.jpg', box: '275 / 768', y: '0%' },
  };

  /*
   * 段階2：トレードオフのシナリオ
   */
  DATA.SCENARIOS = [
    // ---- 共通
    { id: 'C1', target: '共通',
      a: { text: '外資系勤務で{年収×1.6}。ただし平日は毎晩22時過ぎに帰宅し、休日出勤も月2回', plus: ['income'] },
      b: { text: '{年収×1.0}。18時半には帰宅でき、リモート週2日、土日祝は必ず休み', plus: ['workstyle'] } },
    { id: 'C2', target: '共通', visual: { a: ['looks', 0], b: ['looks', 1] },
      a: { text: '顔は好みど真ん中。でも2人でいると会話が途切れがち', plus: ['looks'] },
      b: { text: '顔は普通。でも話していて一番楽しく、笑いのツボも同じ', plus: ['conversation'] } },
    { id: 'C3', target: '共通',
      a: { text: '{年収×1.4}。ただし貯金はほぼゼロで、趣味や外食に毎月10万円以上使う', plus: ['income'] },
      b: { text: '{年収×1.0}。コツコツ積み立てて貯金{貯金×1.0}', plus: ['money'] } },
    { id: 'C4', target: '共通',
      a: { text: '大手メーカー勤務で{年収×1.3}。ただし2〜3年おきに全国転勤があり、地方赴任の可能性大', plus: ['income'] },
      b: { text: '都内の中堅企業で{年収×1.0}。転勤はなく、ずっと東京で暮らせる', plus: ['relocation'] } },
    { id: 'C5', target: '共通', visual: { a: ['looks', 0], b: ['looks', 1] },
      a: { text: '見た目も好みで{年収×1.5}。ただし紙タバコを1日1箱吸い、やめるつもりはない', plus: ['looks', 'income'] },
      b: { text: '見た目も年収も平均的（{年収×1.0}）。タバコは吸わない', plus: ['smoking'] },
      variants: [{ when: { smoker: true },
        a: { text: '見た目も好みで{年収×1.5}。ただしタバコが大嫌いで、付き合うならあなたにも禁煙してほしいと言っている', plus: ['looks', 'income'] },
        b: { text: '見た目も年収も平均的（{年収×1.0}）。あなたがタバコを吸うことはまったく気にしない', plus: ['smoking'] } }] },
    { id: 'C6', target: '共通',
      a: { text: '条件はほぼ理想通り。ただし住まいは乗り換え2回・片道1時間半', plus: ['_overall'] },
      b: { text: '条件は平均的。同じ沿線に住んでいて30分で会える', plus: ['distance'] } },
    { id: 'C7', target: '共通',
      a: { text: '〔好みの年齢〕。ただし価値観や笑いのツボが少しずれる', plus: ['age'] },
      b: { text: '〔好みでない年齢〕。でも価値観がぴったり合う', plus: ['personality'] } },
    { id: 'C8', target: '共通',
      a: { text: '難関大卒・大手企業勤務で{年収×1.1}', plus: ['education'] },
      b: { text: '高卒で営業や現場から叩き上げ、今は{年収×1.3}', plus: ['income'] } },
    { id: 'C9', target: '共通',
      a: { text: '休日は〔好みの休日の過ごし方〕に過ごす派で、一緒に楽しめる。ただし性格はやや合わない', plus: ['hobby'] },
      b: { text: '休日は〔好みでない休日の過ごし方〕に過ごす派。でも性格はぴったり', plus: ['personality'] } },
    { id: 'C10', target: '共通', visual: { a: ['clean', 2], b: ['clean', 0] },
      a: { text: '顔立ちは整っているが、服はヨレヨレで髪もボサボサなことが多い', plus: ['looks'] },
      b: { text: '顔は普通だが、清潔感がありセンスも良い', plus: ['cleanliness'] } },
    { id: 'C11', target: '共通',
      a: { text: '離婚歴あり（子なし・円満離婚）。それ以外の条件は理想的', plus: ['_overall'] },
      b: { text: '初婚。条件は平均的', plus: ['marriage_history'] } },
    { id: 'C12', target: '共通',
      a: { text: '〔好みの関係性〕を築けそうな人。ただし{年収×0.85}', plus: ['leadership'] },
      b: { text: '〔好みでない関係性〕になりそうな人。{年収×1.3}', plus: ['income'] } },
    { id: 'C13', target: '共通', visual: { a: ['looks', 1], b: ['looks', 0] },
      a: { text: 'お酒は〔好みの飲酒スタイル〕。ただし顔は普通', plus: ['drinking'] },
      b: { text: 'お酒は〔好みでない飲酒スタイル〕。顔は好み', plus: ['looks'] } },
    { id: 'C14', target: '共通', cond: { purpose: '婚活' },
      a: { text: '相手の実家が都内で電車30分。子育てを手伝ってもらえるが、義実家と月2〜3回は顔を合わせる',
           plus: [], ideal: { family: '実家が近く、子育てを頼れる人' } },
      b: { text: '相手の実家は地方で、帰省は年1〜2回の飛行機。気楽だが子育ては夫婦だけで頑張る',
           plus: [], ideal: { family: '実家と距離があり、干渉の少ない人' } } },
    { id: 'C15', target: '共通', cond: { purpose: '婚活' }, about: 'kids',
      a: { text: '子どもについて〔考えが一致〕。ただし{年収×0.85}', plus: ['children'] },
      b: { text: '子どもについて〔考えが違う〕。{年収×1.5}', plus: ['income'] } },
    { id: 'C16', target: '共通', visual: { a: ['body', 'pref:body'], b: ['body', 'anti:body'] },
      a: { text: '〔好みの体型〕。ただし休日は自分の趣味優先で別行動が多い', plus: ['body'] },
      b: { text: '〔好みでない体型〕。でも休日は一緒に過ごしてくれる', plus: ['affection'] } },
    { id: 'C17', target: '共通', visual: { a: ['looks', 1], b: ['looks', 0] },
      a: { text: '〔好みの身長〕。ただし顔は普通', plus: ['height'] },
      b: { text: '〔好みでない身長〕。でも顔は好み', plus: ['looks'] } },
    { id: 'C18', target: '共通', visual: { a: ['face', 'pref:face_type'], b: ['figure', 0] },
      a: { text: '〔好みの顔のタイプ〕。ただしスタイルは普通', plus: ['looks'] },
      b: { text: '〔好みでない顔のタイプ〕。でもスタイル抜群', plus: ['body'] } },
    { id: 'C19', target: '共通',
      a: { text: '穏やかで喧嘩は一切しない。ただし愛情表現が少なく、好かれているか不安になる', plus: ['personality'] },
      b: { text: '愛情表現が豊か。ただし感情の起伏が激しく、月に1回は喧嘩になる', plus: ['affection'] } },
    { id: 'C20', target: '共通', visual: { a: ['looks', 1], b: ['looks', 0] },
      a: { text: '連絡は〔好みの連絡頻度〕。ただし見た目は普通', plus: ['contact'] },
      b: { text: '連絡は〔好みでない連絡頻度〕。見た目は好み', plus: ['looks'] } },
    { id: 'C21', target: '共通',
      a: { text: '〔好みの住環境〕で暮らしたい人。世帯の家賃は相応（2LDKで都心なら月25万円前後、郊外なら月13万円前後、地方なら月8万円前後）、{年収×1.0}', plus: ['area'] },
      b: { text: '〔好みでない住環境〕で暮らしたい人。{年収×1.3}', plus: ['income'] } },
    { id: 'C22', target: '共通',
      a: { text: '〔好みの社交性〕。ただし趣味はまったく違う', plus: ['social'] },
      b: { text: '〔好みでない社交性〕。でも趣味が完全に一致', plus: ['hobby'] } },
    { id: 'C23', target: '共通', visual: { a: ['clean', 2], b: ['looks', 0] },
      a: { text: '優しく誠実。ただし服装や外見にまったく興味がない', plus: ['sincerity'] },
      b: { text: 'おしゃれで見た目も好み。ただし少し自分勝手なところがある', plus: ['looks'] } },
    { id: 'C24', target: '共通',
      a: { text: 'やりたい仕事に挑戦するため転職予定。年収は一時的に{年収×0.8}に下がる', plus: ['_overall'] },
      b: { text: '安定した会社で{年収×1.1}。ただし仕事への熱意は薄い', plus: ['job_stability'] } },
    { id: 'C25', target: '共通', cond: { purpose: '婚活' },
      a: { text: '結婚願望が強く、1年以内に結婚したい。条件は平均的', plus: ['marriage_timing'] },
      b: { text: '条件は理想的。ただし「結婚は3年後くらい」と考えている', plus: ['_overall'] } },
    { id: 'C26', target: '共通', visual: { a: ['looks', 0], b: ['looks', 1] },
      a: { text: '見た目も年収も魅力的。ただし過去に浮気歴がある（本人申告・反省している）', plus: ['looks', 'income'] },
      b: { text: '恋愛経験が少なく地味。でも誠実さは間違いない', plus: ['sincerity'] } },

    { id: 'C27', target: '共通', visual: { a: ['animal', 'pref:animal_face'], b: ['animal', 'anti:animal_face'] },
      a: { text: '顔は〔好みの動物顔〕。ただし2人でいると会話はあまり弾まない', plus: ['looks'] },
      b: { text: '顔は〔好みでない動物顔〕。でも話していて一番楽しい', plus: ['conversation'] } },

    { id: 'C28', target: '共通',
      a: { text: 'お酒は飲まない。ただし性格はやや合わない', plus: ['drinking'] },
      b: { text: '毎晩晩酌をして、週末は飲み会も多い。でも性格はぴったり', plus: ['personality'] },
      variants: [{ when: { drinker: true },
        a: { text: '一緒にお酒を楽しめて、あなたの飲み会にも寛容。ただし性格はやや合わない', plus: ['drinking'] },
        b: { text: 'お酒は飲まず、あなたが飲んで帰るといい顔をしない。でも性格はぴったり', plus: ['personality'] } }] },
    { id: 'C29', target: '共通',
      a: { text: 'タバコは吸わない。ただし会話はあまり弾まない', plus: ['smoking'] },
      b: { text: '加熱式タバコを1日10本ほど吸う。でも話していて一番楽しい', plus: ['conversation'] },
      variants: [{ when: { smoker: true },
        a: { text: '自分は吸わないが、あなたの喫煙には寛容。ただし会話はあまり弾まない', plus: ['smoking'] },
        b: { text: 'タバコの臭いが苦手で、あなたに禁煙を求めている。でも話していて一番楽しい', plus: ['conversation'] } }] },

    { id: 'C30', target: '共通', visual: { a: ['style', 'pref:fashion'], b: ['style', 'anti:fashion'] },
      a: { text: '服装はいつも〔好みのファッション〕。ただし2人でいると会話はあまり弾まない', plus: ['fashion'] },
      b: { text: '服装は〔好みでないファッション〕。でも話していて一番楽しい', plus: ['conversation'] } },
    { id: 'C31', target: '共通', visual: { a: ['style', 'pref:fashion'], b: ['looks', 0] },
      a: { text: '服装はいつも〔好みのファッション〕。ただし顔は普通', plus: ['fashion'] },
      b: { text: '服装は〔好みでないファッション〕。でも顔立ちは整っている', plus: ['looks'] } },

    // ---- 相手が男性のとき
    { id: 'M1', target: '男性', cond: { purpose: '婚活' },
      a: { text: '{年収×1.8}。ただし家事育児はほぼ妻任せ', plus: ['income'] },
      b: { text: '{年収×0.9}。家事育児を半分以上担う', plus: ['housework', 'parenting'] } },
    { id: 'M2', target: '男性', cond: { purpose: '婚活' },
      a: { text: '長男で{年収×1.3}。ただし将来は地方の実家に戻るか、同居の可能性あり', plus: ['income'] },
      b: { text: '次男で{年収×1.0}。住む場所は自由に決められる', plus: ['eldest_son'] } },
    { id: 'M3', target: '男性',
      a: { text: '〔好みの身長〕。ただし{年収×0.85}', plus: ['height'] },
      b: { text: '〔好みでない身長〕。{年収×1.3}', plus: ['income'] } },
    { id: 'M4', target: '男性', cond: { purpose: '婚活' }, about: 'my_work',
      a: { text: '結婚後のあなたの働き方について〔考えが一致〕。{年収×1.0}', plus: ['wife_work'] },
      b: { text: '結婚後のあなたの働き方について〔考えが違う〕。{年収×1.6}', plus: ['income'] } },
    { id: 'M5', target: '男性', visual: { a: ['hair', 1], b: ['hair', 0] },
      a: { text: '髪のボリュームが少なめ。ただし性格は理想通りで、{年収×1.3}', plus: ['_overall'] },
      b: { text: '髪はフサフサ。性格は平均的で、{年収×1.0}', plus: ['hair'] } },
    { id: 'M6', target: '男性',
      a: { text: '自営業で、年収は年によって{年収×0.6〜2.0}と大きく変動', plus: ['income'] },
      b: { text: '都庁・区役所勤務の公務員で{年収×0.95}、将来も安定', plus: ['job_stability'] } },
    { id: 'M7', target: '男性',
      a: { text: '母親と仲が良く、毎日LINEして週1で実家に帰る。それ以外は理想的', plus: ['_overall'] },
      b: { text: '家族とは適度な距離感で、帰省は盆と正月だけ。条件は平均的', plus: ['family'] } },
    { id: 'M8', target: '男性',
      a: { text: '料理が得意で毎日作ってくれる。ただし{年収×0.8}', plus: ['housework'] },
      b: { text: '料理はまったくできない。{年収×1.5}', plus: ['income'] } },
    { id: 'M9', target: '男性',
      a: { text: '月に1〜2万円ほどパチンコや競馬を楽しむ。それ以外は理想的', plus: ['_overall'] },
      b: { text: 'ギャンブルは一切しない。条件は平均的', plus: ['money'] } },
    { id: 'M10', target: '男性',
      a: { text: '仕事一筋で職場の出世頭。ただし記念日や誕生日を忘れがち', plus: ['income'] },
      b: { text: '出世には興味がないが、記念日やサプライズを大切にする', plus: ['affection'] } },
    { id: 'M11', target: '男性',
      a: { text: '車好きで運転が上手く、週末は遠出に連れて行ってくれる。ただし駐車場代を含め車に年100万円かける', plus: ['hobby'] },
      b: { text: '車は持たず、必要なときだけカーシェア。遠出は電車', plus: ['money'] } },
    { id: 'M12', target: '男性',
      a: { text: '〔好みの年齢〕で初婚。{年収×1.0}', plus: ['age'] },
      b: { text: '〔好みでない年齢〕。{年収×1.5}', plus: ['income'] } },
    { id: 'M13', target: '男性',
      a: { text: 'デート代は毎回全額出してくれる。ただし「男が稼いで女が支える」という考えが強い',
           plus: ['_overall'], ideal: { wife_work: '稼いで支えてくれる人' } },
      b: { text: 'デート代は割り勘。家事も仕事も対等に考えている',
           plus: ['wife_work'], ideal: { wife_work: '家事も仕事も対等に考える人' } } },
    { id: 'M14', target: '男性', visual: { a: ['figure', 2], b: ['figure', 0] },
      a: { text: '背が高く体格も良い。ただし運動不足でお腹が出始めている', plus: ['height'] },
      b: { text: '身長は平均的。ジム通いで体型を維持している', plus: ['body'] } },

    // ---- 相手が女性のとき
    { id: 'F1', target: '女性', visual: { a: ['looks', 1], b: ['looks', 0] }, cond: { purpose: '婚活' }, about: 'wife_work',
      a: { text: '結婚後の働き方について〔考えが一致〕。容姿は普通', plus: ['career'] },
      b: { text: '結婚後の働き方について〔考えが違う〕。容姿は好み', plus: ['looks'] } },
    { id: 'F2', target: '女性', visual: { a: ['looks', 0], b: ['looks', 1] },
      a: { text: '誰もが認める美人。ただし美容院・ネイル・まつげ・服で月5万円かける', plus: ['looks'] },
      b: { text: '容姿は普通。美容・服飾費は月1.5万円程度', plus: ['beauty_cost'] } },
    { id: 'F3', target: '女性', visual: { a: ['looks', 1], b: ['looks', 0] }, adult: true,
      a: { text: '胸は〔好みの胸の大きさ〕。ただし顔は普通', plus: ['bust'] },
      b: { text: '胸は〔好みでない胸の大きさ〕。顔は好み', plus: ['looks'] } },
    { id: 'F4', target: '女性', cond: { purpose: '婚活', minAge: 32, maxAge: 50 },
      a: { text: '〔大きく年下〕で、子どもを持つ計画を立てやすい。ただし話題が合わないことが多い', plus: ['age'] },
      b: { text: '同年代で話題も価値観も合う。子どもについては早めに話し合っておきたい', plus: ['personality'] } },
    { id: 'F5', target: '女性',
      a: { text: '料理が得意で毎日手作り。仕事はパート（年収120万円前後）', plus: ['cooking'] },
      b: { text: '料理はほぼしない。正社員で{年収×1.0}', plus: ['income'] } },
    { id: 'F6', target: '女性', visual: { a: ['makeup', 'pref:makeup'], b: ['makeup', 'anti:makeup'] },
      a: { text: 'メイクやファッションは〔好みのスタイル〕。性格は普通', plus: ['makeup'] },
      b: { text: 'メイクやファッションは〔好みでないスタイル〕。性格はぴったり', plus: ['personality'] } },
    { id: 'F7', target: '女性', visual: { a: ['body', 'pref:body'], b: ['body', 'anti:body'] },
      a: { text: '〔好みの体型〕。ただし性格はややドライ', plus: ['body'] },
      b: { text: '〔好みでない体型〕。でも明るく家庭的な性格', plus: ['personality'] } },
    { id: 'F8', target: '女性',
      a: { text: '母親と何でも相談する仲で、休日は月2回ほど実家で過ごす。それ以外は理想的', plus: ['_overall'] },
      b: { text: '家族とは適度な距離感。条件は平均的', plus: ['family'] } },
    { id: 'F9', target: '女性',
      a: { text: '家事は完璧で家はいつもきれい。ただし几帳面で細かいことをよく指摘される', plus: ['housework'] },
      b: { text: '家事はざっくりで部屋も少し散らかりがち。でもおおらかで細かいことを気にしない', plus: ['personality'] } },
    { id: 'F10', target: '女性', visual: { a: ['looks', 0], b: ['looks', 1] },
      a: { text: '美人で恋愛経験が豊富', plus: ['looks'] },
      b: { text: '容姿は普通で恋愛経験は少なめ', plus: ['sincerity'] } },
    { id: 'F11', target: '女性', cond: { purpose: '婚活' },
      a: { text: 'キャリア志向で{年収×1.2}。ただし出張や残業が多く、平日はすれ違いがち',
           plus: ['income'], ideal: { career: 'フルタイムで働き続ける人' } },
      b: { text: 'パート勤務で年収120万円前後。時間に融通が利き、家にいることが多い',
           plus: ['workstyle'], ideal: { career: 'パートなど時間に融通が利く人' } } },
    { id: 'F12', target: '女性',
      a: { text: '甘え上手で一緒にいると癒される。ただしやきもち焼きで、異性との飲み会にいい顔をしない', plus: ['affection'] },
      b: { text: '自立していて干渉しない。ただしあまり甘えてこない', plus: ['_overall'] } },
    { id: 'F13', target: '女性', cond: { purpose: '婚活' },
      a: { text: '家計を全部管理してくれて節約上手、貯金も増える。ただしあなたはお小遣い制（月3〜4万円）', plus: ['money'] },
      b: { text: '家計は別財布でそれぞれ自由。ただし貯金は増えにくい', plus: ['_overall'] } },
    { id: 'F14', target: '女性',
      a: { text: '〔好みの身長〕。ただしパート勤務で年収120万円前後', plus: ['height'] },
      b: { text: '〔好みでない身長〕。正社員で{年収×1.0}', plus: ['income'] } },
  ];

  // 性生活（大人の話）の質問を含める人だけに出すシナリオ
  DATA.SCENARIOS.push(
    { id: 'X1', target: '共通', adult: true,
      a: { text: '体の相性は抜群。ただし2人でいると会話はあまり弾まない', plus: ['sex_compat'] },
      b: { text: '話していて一番楽しい。ただし体の相性はいまひとつ', plus: ['conversation'] } },
    { id: 'X2', target: '共通', adult: true,
      a: { text: '性生活の頻度は〔好みの頻度〕が理想で、あなたと一致。ただし{年収×0.85}', plus: ['sex_freq'] },
      b: { text: '性生活の頻度は〔好みでない頻度〕が理想。{年収×1.3}', plus: ['income'] } },
    { id: 'X3', target: '共通', visual: { a: ['looks', 1], b: ['looks', 0] }, adult: true,
      a: { text: '体の相性は抜群。ただし顔は普通', plus: ['sex_compat'] },
      b: { text: '顔は好み。ただし体の相性はいまひとつ', plus: ['looks'] } },
    { id: 'X4', target: '共通', adult: true,
      a: { text: '性生活の頻度は〔好みの頻度〕が理想で、あなたと一致。ただし性格はやや合わない', plus: ['sex_freq'] },
      b: { text: '性生活の頻度は〔好みでない頻度〕が理想。でも性格はぴったり', plus: ['personality'] } }
  );

  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.HONNE_DATA = DATA;
})(this);
