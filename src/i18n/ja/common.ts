/**
 * 共通の UI 文言（日本語）。ゲーム固有の文言は同じフォルダの <game-id>.ts に置く。
 * 文言ルールは仕様書 第12節（`npm run lint:words` でチェック）。
 */
export const common = {
  appName: 'Brain Fighter',
  appTagline: '反応・記憶・切り替えを試す3分ミニゲーム集',

  nav: {
    home: 'ホーム',
    records: '記録',
    settings: '設定',
    cert: '昇段審査',
    back: 'もどる',
  },

  home: {
    totalPower: '総合戦闘力',
    power: '戦闘力',
    totalBelt: '総合ベルト',
    startSession: '今日のセッション',
    sessionNote: '3つのミニゲームを順番に1試合ずつ遊びます（約12〜15分）',
    resumeSession: (game: string): string => `続きから（次は ${game}）`,
    sessionWait: (time: string): string => `次のセッションは ${time} から遊べます（同じ日の2回目は4時間あけます）`,
    sessionLimit: '今日のセッションは2回とも終わりました。また明日。',
    weekDays: (x: number, goal: number): string => `今週 ${x} / ${goal} 日`,
    certReady: '昇段審査に挑めます',
    certButton: '昇段審査へ',
    notPlayed: 'まだ記録がありません',
  },

  play: {
    round: (n: number, total: number): string => `ラウンド ${n}/${total}`,
    extraRound: 'もう1ラウンド',
    warmup: 'ウォームアップ',
    enemyLevel: (lv: number): string => `敵レベル ${lv}`,
    you: 'あなた',
    quit: '中断',
    quitConfirm: 'この試合を中断してホームに戻りますか？（途中のラウンドは記録されません）',
    start: 'スタート',
    readyTitle: (game: string): string => `${game}`,
    nextRound: '次のラウンドへ',
    roundEnd: (n: number): string => `ラウンド ${n} 終了`,
    warmupEnd: 'ウォームアップ終了',
    warmupNote: '次からラウンドが始まります',
    accuracy: '正答率',
    maxCombo: '最大コンボ',
    power: '戦闘力',
    best: '自己ベスト',
    toResult: '結果へ',
    extraAsk: 'もう1ラウンド遊べます',
    down: 'ダウン',
    combo: (n: number): string => `${n} コンボ`,
    gameNotFound: 'ゲームが見つかりません',
  },

  outcome: {
    ko: 'KO',
    perfect: 'PERFECT',
    decision: '判定負け',
    koNext: (n: number): string => `次は あと ${n} 問で KO`,
  },

  result: {
    title: '試合結果',
    roundsHeading: 'ラウンドごとの結果',
    accuracy: '正答率',
    maxCombo: '最大コンボ',
    power: '戦闘力',
    powerChange: (before: number, after: number): string => `${before} → ${after}`,
    bestDiff: '自己ベストとの差',
    newBest: '自己ベスト更新',
    nextGame: (game: string): string => `次のゲームへ（${game}）`,
    sessionDone: '今日のセッションはここまでです。おつかれさまでした。',
    home: 'ホームへ',
    records: '記録を見る',
    none: '表示できる結果がありません',
  },

  records: {
    title: '記録',
    totalChart: '総合戦闘力（日ごとの最大）',
    gameChart: 'ゲーム別の戦闘力（日ごとの最大）',
    beltChart: 'ベルト（認定戦の結果）',
    accuracyChart: 'ラウンドの正答率（目安 75〜85%）',
    weekDays: (x: number, goal: number): string => `今週の実施日数 ${x} / ${goal} 日`,
    explain:
      '戦闘力は毎日の訓練ラウンドで到達した難度から計算する、ゲーム内の成績です。ベルトは週1回の認定戦（訓練とは別の形式・別の刺激で測る公式記録）で決まります。戦闘力が演出や慣れで上がっても、認定戦の結果は上がらないことがあります。',
    empty: 'まだ記録がありません。今日のセッションを遊ぶと、ここにグラフが出ます。',
    beltEmpty: 'まだ認定戦の記録がありません。',
    rounds: (n: number): string => `訓練ラウンド ${n} 本`,
    targetBand: '目安 75〜85%',
    tableView: '表で見る',
    chartAria: (title: string): string => `${title}（←→ キーで値を読めます）`,
    date: '日付',
    round: 'ラウンド',
    roundNo: (n: number): string => `${n} 本目`,
  },

  cert: {
    title: '昇段審査（認定戦）',
    explain:
      '固定の難度・初めて見る刺激・最小限の演出で2ラウンド行います。2ラウンドとも正答率 79% 以上で合格し、そのゲームのベルトが1つ上がります。不合格でもベルトは下がりません。',
    conditions: 'そのゲームの訓練が3日以上、かつ前回の認定戦から7日以上たつと挑めます。',
    ready: '挑めます',
    needDays: (have: number, need: number): string => `訓練 ${have} / ${need} 日`,
    nextDate: (date: string): string => `${date} から挑めます`,
    preparing: '認定戦の実施画面は準備中です。',
  },

  settings: {
    title: '設定',
    fxHeading: '演出',
    fx: {
      off: 'Off（課題と正誤の色だけ）',
      light: 'Light（標準: 体力ゲージ・効果音・KO 表示）',
      full: 'Full（Light ＋ コンボ表示・技名テロップ・背景）',
    },
    fxNote: 'どの演出でも、試行数・提示時間・刺激の間隔・応答期限は同じです。',
    displayHeading: '音と表示',
    sound: '効果音',
    colorSafe: '色覚配慮モード（正誤の色を青／橙にする）',
    dataHeading: 'データ',
    exportButton: 'エクスポート（JSON を保存）',
    importButton: 'インポート（ファイルを選ぶ）',
    importPreview: (createdAt: string, rounds: number, total: number): string =>
      `作成日 ${createdAt} ／ 訓練ラウンド ${rounds} 本 ／ 総合戦闘力 ${total}`,
    importReplace: '置き換える',
    importCancel: 'やめる',
    importConfirm: 'いまの記録と設定をすべて消して、このファイルの内容に置き換えます。よろしいですか？',
    importError: (msg: string): string => `このファイルは読み込めません（${msg}）`,
    imported: '置き換えました。',
    clearButton: '全消去',
    clearConfirm: '記録と設定をすべて消去します。元に戻せません。よろしいですか？',
    cleared: '消去しました。',
    storageUnavailable:
      'この環境では記録を保存できません（プライベートモードなど）。遊ぶことはできますが、ページを閉じると記録は消えます。',
    storagePruned: '保存容量が足りないため、古い試行ログを減らして保存しました。',
    storageFailed: '記録を保存できませんでした。',
    backupNote: '読み込めなかった古いデータは消さずに別の場所へ退避しました。',
    aboutHeading: 'このアプリについて',
    description:
      '反応・記憶・切り替えを試す3分ミニゲーム集。格闘ゲーム風の演出で、ゲーム内の成績（戦闘力）と自己ベストを記録できます。心理学の実験で使われる課題形式（n-back、タスクスイッチ等）を採用しています。',
    disclaimer:
      '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。',
    privacy: '記録はこの端末のブラウザの中だけに保存されます。サーバーへは送りません。',
    version: (v: string): string => `バージョン ${v}`,
  },

  belts: ['白帯', '黄帯', '橙帯', '緑帯', '青帯', '紫帯', '茶帯', '赤帯', '黒帯', '黒帯二段'] as readonly string[],
} as const;

export type CommonText = typeof common;
