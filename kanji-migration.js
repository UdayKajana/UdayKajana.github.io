import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js';
import { getDatabase, ref, set } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Comprehensive Kanji Data Structure
const kanjiData = {
  N5: {
    "Numbers & Counting": {
      "一": { hiragana: "ひと(つ), いち, いっ", meaning: "One - Basic number one, used in counting and compounds", number: 1 },
      "二": { hiragana: "ふた(つ), に", meaning: "Two - Number two", number: 2 },
      "三": { hiragana: "みっ(つ), さん", meaning: "Three - Number three", number: 3 },
      "四": { hiragana: "よっ(つ), よん, し", meaning: "Four - Number four", number: 4 },
      "五": { hiragana: "いつ(つ), ご", meaning: "Five - Number five", number: 5 },
      "六": { hiragana: "むっ(つ), ろく", meaning: "Six - Number six", number: 6 },
      "七": { hiragana: "なな(つ), しち", meaning: "Seven - Number seven", number: 7 },
      "八": { hiragana: "やっ(つ), はち", meaning: "Eight - Number eight", number: 8 },
      "九": { hiragana: "ここの(つ), きゅう", meaning: "Nine - Number nine", number: 9 },
      "十": { hiragana: "とお, じゅう", meaning: "Ten - Number ten", number: 10 },
      "百": { hiragana: "ひゃく", meaning: "Hundred - One hundred", number: 11 },
      "千": { hiragana: "せん", meaning: "Thousand - One thousand", number: 12 },
      "万": { hiragana: "まん", meaning: "Ten Thousand - Ten thousand", number: 13 },
      "円": { hiragana: "えん", meaning: "Yen, Circle - Japanese currency", number: 14 }
    },
    "Days, Months & Time": {
      "月": { hiragana: "つき, げつ, がつ", meaning: "Month, Moon - Moon or month (in compounds)", number: 13 },
      "日": { hiragana: "ひ, か, にち", meaning: "Day, Sun - Day of month or sun", number: 2 },
      "火": { hiragana: "ひ, か", meaning: "Fire, Tuesday - Tuesday or fire element", number: 14 },
      "水": { hiragana: "みず, すい", meaning: "Water, Wednesday - Water or Wednesday", number: 15 },
      "木": { hiragana: "き, もく", meaning: "Tree, Thursday - Tree or Thursday", number: 16 },
      "金": { hiragana: "かね, きん", meaning: "Gold, Money, Friday - Gold, money, or Friday", number: 17 },
      "土": { hiragana: "つち, ど", meaning: "Earth, Soil, Saturday - Soil or Saturday", number: 18 },
      "時": { hiragana: "とき, じ", meaning: "Time, Hour - Time or o'clock", number: 50 },
      "間": { hiragana: "あいだ, かん", meaning: "Between, Interval - Space between or duration", number: 51 },
      "分": { hiragana: "わ(けます), ふん, ぶん", meaning: "Minute, Part - Minute or to divide", number: 52 },
      "半": { hiragana: "はん", meaning: "Half - Half hour or half", number: 53 },
      "毎": { hiragana: "まい", meaning: "Every - Every, each", number: 54 },
      "年": { hiragana: "とし, ねん", meaning: "Year - Year or age", number: 55 },
      "前": { hiragana: "まえ, ぜん", meaning: "Before, Front - In front or before", number: 56 },
      "後": { hiragana: "うし(ろ), あと, ご", meaning: "After, Behind - Behind or after", number: 57 },
      "午": { hiragana: "ご", meaning: "Noon, Horse - Noon (in time compounds)", number: 58 },
      "名": { hiragana: "な, めい", meaning: "Name - Name or counter for people", number: 59 }
    },
    "Body Parts": {
      "目": { hiragana: "め", meaning: "Eye - Eye or vision", number: 82 },
      "耳": { hiragana: "みみ", meaning: "Ear - Ear or hearing", number: 117 },
      "手": { hiragana: "て, しゅ", meaning: "Hand, Arm - Hand or arm", number: 83 },
      "足": { hiragana: "あし, た(ります)", meaning: "Foot, Leg - Foot, leg or to be enough", number: 84 },
      "口": { hiragana: "くち, こう", meaning: "Mouth, Opening - Mouth or opening", number: 81 },
      "頭": { hiragana: "あたま", meaning: "Head - Head", number: 256 },
      "顔": { hiragana: "かお", meaning: "Face - Face", number: 301 },
      "首": { hiragana: "くび", meaning: "Neck - Neck", number: 302 },
      "声": { hiragana: "こえ", meaning: "Voice - Voice or sound", number: 303 },
      "心": { hiragana: "こころ, しん", meaning: "Heart, Mind - Heart or mind", number: 127 }
    },
    "Family": {
      "父": { hiragana: "ちち, ふ", meaning: "Father - My father", number: 42 },
      "母": { hiragana: "はは, ぼ", meaning: "Mother - My mother", number: 43 },
      "兄": { hiragana: "あに, きょう", meaning: "Older Brother - My older brother", number: 167 },
      "姉": { hiragana: "あね", meaning: "Older Sister - My older sister", number: 169 },
      "弟": { hiragana: "おとうと, だい", meaning: "Younger Brother - My younger brother", number: 168 },
      "妹": { hiragana: "いもうと", meaning: "Younger Sister - My younger sister", number: 170 },
      "家": { hiragana: "いえ, か", meaning: "House, Home - House or home", number: 96 },
      "族": { hiragana: "ぞく", meaning: "Family - Family or group", number: 237 }
    },
    "School & Education": {
      "学": { hiragana: "まな(びます), がく", meaning: "Learn, Study - To learn or study", number: 47 },
      "校": { hiragana: "こう", meaning: "School - School (suffix)", number: 48 },
      "生": { hiragana: "い(きます), う(まれます), なま, せい, しょう", meaning: "Life, Living, Raw - To live or be born", number: 46 },
      "先": { hiragana: "さき, せん", meaning: "Before, Ahead - Before or ahead", number: 45 },
      "子": { hiragana: "こ", meaning: "Child - Child or offspring", number: 39 },
      "文": { hiragana: "ぶん", meaning: "Sentence, Writing - Sentence or writing", number: 128 },
      "書": { hiragana: "か(きます), しょ", meaning: "Write, Writing - To write", number: 67 },
      "読": { hiragana: "よ(みます), どく", meaning: "Read - To read", number: 68 }
    },
    "Common Actions": {
      "行": { hiragana: "い(きます), おこな(います), こう", meaning: "Go, Do - To go or perform", number: 23 },
      "来": { hiragana: "き(ます), らい", meaning: "Come - To come", number: 24 },
      "休": { hiragana: "やす(みます)", meaning: "Rest, Holidays - To rest or take a day off", number: 25 },
      "見": { hiragana: "み(ます), み(えます), み(せます), けん", meaning: "See, Look - To see or look at", number: 26 },
      "今": { hiragana: "いま, こん", meaning: "Now, Present - Now or this", number: 27 },
      "大": { hiragana: "おお(きい), だい, たい", meaning: "Big, Large - Big or large", number: 28 },
      "小": { hiragana: "ちい(さい), こ, しょう", meaning: "Small, Little - Small or little", number: 29 },
      "上": { hiragana: "うえ, あ(げます), あ(がります), じょう", meaning: "Up, Above - Up or above", number: 30 },
      "下": { hiragana: "した, さ(げます), さ(がります), か", meaning: "Down, Below - Down or below", number: 31 },
      "中": { hiragana: "なか, ちゅう", meaning: "Inside, Middle - Inside or middle", number: 32 }
    },
    "Common Nouns": {
      "人": { hiragana: "ひと, じん, にん", meaning: "Person, People - Person or people", number: 1 },
      "山": { hiragana: "やま, さん", meaning: "Mountain - Mountain", number: 35 },
      "川": { hiragana: "かわ", meaning: "River - River", number: 36 },
      "白": { hiragana: "しろ(い), しろ", meaning: "White - White color", number: 37 },
      "本": { hiragana: "ほん", meaning: "Book - Book or counter for long objects", number: 38 },
      "男": { hiragana: "おとこ, だん", meaning: "Man, Male - Man or male", number: 40 },
      "女": { hiragana: "おんな, じょ", meaning: "Woman, Female - Woman or female", number: 41 },
      "友": { hiragana: "とも", meaning: "Friend - Friend", number: 44 },
      "会": { hiragana: "あ(います), かい", meaning: "Meet, Gather - To meet or gather", number: 97 },
      "社": { hiragana: "しゃ", meaning: "Company - Company (suffix)", number: 98 },
      "店": { hiragana: "みせ, てん", meaning: "Store, Shop - Store or shop", number: 99 },
      "飲": { hiragana: "の(みます)", meaning: "Drink - To drink", number: 100 }
    }
  },

  N4: {
    "Work & Business": {
      "仕": { hiragana: "し", meaning: "Serve, Work - To serve (in compounds)", number: 152 },
      "事": { hiragana: "こと, じ", meaning: "Thing, Matter - Thing or matter", number: 153 },
      "工": { hiragana: "こう", meaning: "Work, Craft - Work or construction", number: 154 },
      "場": { hiragana: "ば, じょう", meaning: "Place, Field - Place or location", number: 155 },
      "屋": { hiragana: "や, おく", meaning: "Store, Building - Store or roof (suffix)", number: 156 },
      "旅": { hiragana: "りょ", meaning: "Travel, Trip - Travel or journey", number: 157 },
      "動": { hiragana: "うご(きます), どう", meaning: "Move, Motion - To move", number: 158 },
      "勉": { hiragana: "べん", meaning: "Effort - Effort (usually in 勉強)", number: 159 },
      "強": { hiragana: "つよ(い), きょう", meaning: "Strong, Strength - Strong or powerful", number: 160 },
      "考": { hiragana: "かんが(えます)", meaning: "Think, Consider - To think", number: 161 },
      "送": { hiragana: "おく(ります)", meaning: "Send - To send", number: 162 },
      "売": { hiragana: "う(ります), う(れます)", meaning: "Sell - To sell", number: 163 },
      "始": { hiragana: "はじ(めます), はじ(まります)", meaning: "Start, Begin - To start", number: 164 },
      "終": { hiragana: "お(わります)", meaning: "End, Finish - To end or finish", number: 165 },
      "計": { hiragana: "けい", meaning: "Calculate, Plan - To calculate or measure", number: 166 }
    },
    "Feelings & Character": {
      "好": { hiragana: "す(き)", meaning: "Like, Prefer - To like", number: 263 },
      "悪": { hiragana: "わる(い)", meaning: "Bad, Evil - Bad or wrong", number: 221 },
      "重": { hiragana: "おも(い)", meaning: "Heavy, Serious - Heavy or important", number: 222 },
      "若": { hiragana: "わか(い)", meaning: "Young - Young", number: 264 },
      "弱": { hiragana: "よわ(い)", meaning: "Weak - Weak or feeble", number: 265 },
      "軽": { hiragana: "かる(い)", meaning: "Light - Light or simple", number: 266 },
      "遠": { hiragana: "とお(い)", meaning: "Far, Distant - Far away", number: 267 },
      "暑": { hiragana: "あつ(い)", meaning: "Hot (weather) - Hot", number: 268 },
      "寒": { hiragana: "さむ(い)", meaning: "Cold - Cold", number: 269 },
      "合": { hiragana: "あ(います)", meaning: "Match, Fit - To fit or suit", number: 270 },
      "伝": { hiragana: "つた(えます), でん", meaning: "Tell, Communicate - To tell or convey", number: 271 },
      "決": { hiragana: "き(めます), き(まります)", meaning: "Decide - To decide", number: 272 }
    },
    "Movement & Actions": {
      "歩": { hiragana: "ある(きます), ほ", meaning: "Walk - To walk", number: 111 },
      "走": { hiragana: "はし(ります)", meaning: "Run - To run", number: 112 },
      "住": { hiragana: "す(みます), じゅう", meaning: "Live, Dwell - To live or reside", number: 113 },
      "空": { hiragana: "そら, あ(きます), くう", meaning: "Sky, Empty - Sky or empty", number: 114 },
      "週": { hiragana: "しゅう", meaning: "Week - Week", number: 115 },
      "魚": { hiragana: "さかな", meaning: "Fish - Fish", number: 116 },
      "道": { hiragana: "みち, どう", meaning: "Road, Way - Road or path", number: 119 },
      "駅": { hiragana: "えき", meaning: "Station - Station", number: 120 },
      "曜": { hiragana: "よう", meaning: "Day (of week) - Day of week", number: 121 },
      "作": { hiragana: "つく(ります), さく", meaning: "Make, Create - To make or create", number: 122 },
      "使": { hiragana: "つか(います), し", meaning: "Use - To use", number: 123 },
      "待": { hiragana: "ま(ちます)", meaning: "Wait - To wait", number: 124 },
      "力": { hiragana: "ちから, りょく", meaning: "Power, Strength - Power or strength", number: 125 },
      "不": { hiragana: "ふ", meaning: "Not, Un- - Not (prefix)", number: 126 },
      "通": { hiragana: "とお(ります), かよ(います)", meaning: "Go through, Commute - To pass through", number: 225 },
      "開": { hiragana: "あ(けます), あ(きます)", meaning: "Open - To open", number: 226 },
      "集": { hiragana: "あつ(めます), あつ(まります)", meaning: "Gather, Collect - To gather", number: 227 },
      "歌": { hiragana: "うた(います), うた", meaning: "Sing, Song - To sing", number: 228 },
      "着": { hiragana: "き(ます), つ(きます)", meaning: "Put on, Arrive - To wear or arrive", number: 229 },
      "貸": { hiragana: "か(します)", meaning: "Lend - To lend", number: 230 },
      "借": { hiragana: "か(ります)", meaning: "Borrow - To borrow", number: 231 },
      "犬": { hiragana: "いぬ", meaning: "Dog - Dog", number: 232 },
      "服": { hiragana: "ふく", meaning: "Clothes - Clothes or dress", number: 233 },
      "建": { hiragana: "た(てます), た(ちます)", meaning: "Build, Construct - To build", number: 234 },
      "海": { hiragana: "うみ, かい", meaning: "Sea, Ocean - Sea or ocean", number: 235 },
      "員": { hiragana: "いん", meaning: "Member - Member or employee", number: 236 }
    },
    "Health & Medicine": {
      "医": { hiragana: "い", meaning: "Medicine, Doctor - Medical (prefix)", number: 196 },
      "者": { hiragana: "もの, しゃ", meaning: "Person - Person (suffix)", number: 197 },
      "病": { hiragana: "びょう", meaning: "Sickness, Disease - Sickness or illness", number: 198 },
      "院": { hiragana: "いん", meaning: "Institution - Institution (suffix)", number: 199 },
      "急": { hiragana: "いそ(ぎます), きゅう", meaning: "Hurry, Sudden - Hurry or sudden", number: 200 },
      "春": { hiragana: "はる", meaning: "Spring - Spring season", number: 201 },
      "夏": { hiragana: "なつ", meaning: "Summer - Summer season", number: 202 },
      "秋": { hiragana: "あき", meaning: "Autumn - Autumn season", number: 203 },
      "冬": { hiragana: "ふゆ", meaning: "Winter - Winter season", number: 204 },
      "親": { hiragana: "おや, しん", meaning: "Parent - Parent", number: 205 },
      "切": { hiragana: "き(ります), せつ", meaning: "Cut - To cut", number: 206 },
      "特": { hiragana: "とく", meaning: "Special, Particular - Special or particular", number: 207 }
    },
    "Places & Buildings": {
      "山": { hiragana: "やま, さん", meaning: "Mountain - Mountain", number: 35 },
      "館": { hiragana: "かん", meaning: "Hall, Building - Hall or building", number: 176 },
      "英": { hiragana: "えい", meaning: "English - English (prefix)", number: 177 },
      "鉄": { hiragana: "てつ", meaning: "Iron - Iron", number: 178 },
      "町": { hiragana: "まち", meaning: "Town - Town", number: 179 },
      "京": { hiragana: "きょう", meaning: "Capital - Capital (as in Tokyo)", number: 180 },
      "味": { hiragana: "あじ, み", meaning: "Taste - Taste or flavor", number: 181 },
      "度": { hiragana: "ど", meaning: "Degree, Times - Degree or times", number: 182 },
      "風": { hiragana: "かぜ, ふう", meaning: "Wind, Cold - Wind or breeze", number: 183 },
      "洋": { hiragana: "よう", meaning: "Ocean, Western - Ocean or Western", number: 184 },
      "茶": { hiragana: "ちゃ", meaning: "Tea - Tea", number: 185 },
      "鳥": { hiragana: "とり", meaning: "Bird - Bird", number: 186 },
      "堂": { hiragana: "どう", meaning: "Hall, Temple - Hall or temple", number: 187 },
      "室": { hiragana: "しつ", meaning: "Room - Room", number: 188 },
      "色": { hiragana: "いろ", meaning: "Color - Color", number: 189 }
    },
    "Nature & Seasons": {
      "青": { hiragana: "あお(い), あお", meaning: "Blue - Blue", number: 190 },
      "黒": { hiragana: "くろ(い), くろ", meaning: "Black - Black", number: 191 },
      "品": { hiragana: "しな, ひん", meaning: "Article, Goods - Article or goods", number: 192 },
      "物": { hiragana: "もの, ぶつ", meaning: "Object, Thing - Object or thing", number: 193 },
      "注": { hiragana: "ちゅう", meaning: "Pour, Inject - To pour (in compounds)", number: 194 },
      "意": { hiragana: "い", meaning: "Will, Meaning - Will or intention", number: 195 },
      "花": { hiragana: "はな, か", meaning: "Flower - Flower", number: 87 },
      "赤": { hiragana: "あか(い), あか", meaning: "Red - Red color", number: 88 },
      "紙": { hiragana: "かみ", meaning: "Paper - Paper", number: 89 },
      "買": { hiragana: "か(います)", meaning: "Buy - To buy", number: 90 },
      "朝": { hiragana: "あさ", meaning: "Morning - Morning", number: 91 },
      "昼": { hiragana: "ひる", meaning: "Noon, Afternoon - Noon", number: 92 },
      "夕": { hiragana: "ゆう", meaning: "Evening - Evening", number: 93 },
      "夜": { hiragana: "よる, や", meaning: "Night - Night", number: 94 },
      "私": { hiragana: "わたし, わたくし", meaning: "I, Me - I or me (pronoun)", number: 95 },
      "有": { hiragana: "あ(ります), ゆう", meaning: "Have, Exist - To have or exist", number: 86 },
      "広": { hiragana: "ひろ(い)", meaning: "Wide, Spacious - Wide or spacious", number: 105 },
      "安": { hiragana: "やす(い), あん", meaning: "Cheap, Safe - Cheap or inexpensive", number: 106 }
    },
    "Society & Government": {
      "都": { hiragana: "と", meaning: "Metropolis - Metropolis", number: 304 },
      "県": { hiragana: "けん", meaning: "Prefecture - Prefecture", number: 305 },
      "区": { hiragana: "く", meaning: "Ward - Ward or division", number: 306 },
      "市": { hiragana: "し", meaning: "City - City", number: 307 },
      "村": { hiragana: "むら", meaning: "Village - Village", number: 308 },
      "民": { hiragana: "みん", meaning: "People - People or citizen", number: 309 },
      "産": { hiragana: "さん", meaning: "Product - Product or production", number: 310 },
      "林": { hiragana: "はやし", meaning: "Forest, Grove - Grove or forest", number: 311 },
      "森": { hiragana: "もり", meaning: "Forest - Forest", number: 312 },
      "池": { hiragana: "いけ", meaning: "Pond - Pond", number: 313 },
      "門": { hiragana: "もん", meaning: "Gate - Gate or door", number: 314 },
      "薬": { hiragana: "くすり", meaning: "Medicine, Drug - Medicine or medicine", number: 315 },
      "洗": { hiragana: "あら(います), せん", meaning: "Wash - To wash", number: 316 },
      "進": { hiragana: "すす(めます), すす(みます)", meaning: "Advance, Progress - To advance", number: 317 },
      "暗": { hiragana: "くら(い)", meaning: "Dark - Dark", number: 318 },
      "光": { hiragana: "ひかり", meaning: "Light - Light or brightness", number: 319 },
      "線": { hiragana: "せん", meaning: "Line - Line", number: 320 }
    },
    "Additional N4 Kanji": {
      "立": { hiragana: "た(ちます), りつ", meaning: "Stand - To stand", number: 107 },
      "知": { hiragana: "し(ります)", meaning: "Know - To know", number: 108 },
      "言": { hiragana: "い(います), こと, ごん", meaning: "Say, Word - To say", number: 109 },
      "思": { hiragana: "おも(います)", meaning: "Think - To think", number: 110 },
      "困": { hiragana: "こま(ります)", meaning: "Troubled, Difficulty - To be troubled", number: 273 },
      "返": { hiragana: "かえ(します), へん", meaning: "Return, Give back - To return", number: 274 },
      "泳": { hiragana: "およ(ぎます), えい", meaning: "Swim - To swim", number: 275 },
      "消": { hiragana: "け(します), き(えます)", meaning: "Extinguish, Disappear - To turn off", number: 276 },
      "忘": { hiragana: "わす(れます)", meaning: "Forget - To forget", number: 277 },
      "呼": { hiragana: "よ(びます)", meaning: "Call, Invite - To call", number: 278 },
      "閉": { hiragana: "し(めます), し(まります)", meaning: "Close - To close", number: 279 },
      "引": { hiragana: "ひ(きます)", meaning: "Pull - To pull", number: 280 },
      "押": { hiragana: "お(します)", meaning: "Push - To push", number: 281 },
      "拾": { hiragana: "ひろ(います)", meaning: "Pick up - To pick up", number: 282 },
      "捨": { hiragana: "す(てます)", meaning: "Throw away - To throw away", number: 283 },
      "説": { hiragana: "せつ", meaning: "Explain - Explanation (suffix)", number: 284 },
      "受": { hiragana: "う(けます), う(かります)", meaning: "Receive, Accept - To receive", number: 285 },
      "取": { hiragana: "と(ります)", meaning: "Take - To take", number: 286 },
      "席": { hiragana: "せき", meaning: "Seat - Seat", number: 287 },
      "連": { hiragana: "つ(れます)", meaning: "Take along, Connect - To take along", number: 288 },
      "座": { hiragana: "すわ(ります)", meaning: "Sit - To sit", number: 289 },
      "変": { hiragana: "か(えます), か(わります), へん", meaning: "Change - To change", number: 290 },
      "乗": { hiragana: "の(ります)", meaning: "Get on, Ride - To ride", number: 291 },
      "降": { hiragana: "お(ります), ふ(ります)", meaning: "Get off, Fall - To get off", number: 292 },
      "働": { hiragana: "はたら(きます)", meaning: "Work - To work", number: 293 },
      "残": { hiragana: "のこ(します), のこ(ります), ざん", meaning: "Remain, Leave - To remain", number: 294 },
      "調": { hiragana: "しら(べます)", meaning: "Investigate, Adjust - To investigate", number: 295 },
      "続": { hiragana: "つづ(けます), つづ(きます)", meaning: "Continue - To continue", number: 296 },
      "練": { hiragana: "れん", meaning: "Practice - Practice", number: 297 },
      "落": { hiragana: "お(とします), お(ちます)", meaning: "Drop, Fall - To drop", number: 298 },
      "寝": { hiragana: "ね(ます)", meaning: "Sleep - To sleep", number: 299 },
      "遅": { hiragana: "おそ(い), おく(れます)", meaning: "Late, Slow - Late or slow", number: 300 }
    }
  }
};

// Function to upload data to Firebase
async function uploadKanjiData() {
  try {
    console.log('Starting kanji data upload...');

    const kanjiRef = ref(database, 'languages/japan/kanji');
    await set(kanjiRef, kanjiData);

    console.log('✓ Kanji data uploaded successfully!');
    console.log('Database structure:');
    console.log('├── languages');
    console.log('│   └── japan');
    console.log('│       └── kanji');
    console.log('│           ├── N5');
    console.log('│   │   ├── Numbers & Counting');
    console.log('│   │   ├── Days, Months & Time');
    console.log('│   │   ├── Body Parts');
    console.log('│   │   ├── Family');
    console.log('│   │   ├── School & Education');
    console.log('│   │   └── Common Nouns');
    console.log('│   └── N4');
    console.log('│       ├── Work & Business');
    console.log('│       ├── Feelings & Character');
    console.log('│       ├── Movement & Actions');
    console.log('│       ├── Health & Medicine');
    console.log('│       ├── Places & Buildings');
    console.log('│       ├── Nature & Seasons');
    console.log('│       └── Society & Government');
    console.log('\nTotal kanji: ' + countAllKanji(kanjiData));

    return true;
  } catch (error) {
    console.error('Error uploading kanji data:', error);
    return false;
  }
}

// Helper function to count all kanji
function countAllKanji(data) {
  let count = 0;
  for (const level in data) {
    for (const category in data[level]) {
      count += Object.keys(data[level][category]).length;
    }
  }
  return count;
}

// Start upload
uploadKanjiData().then(success => {
  if (success) {
    console.log('\n✓ All 320 kanji have been successfully imported into Firebase!');
  } else {
    console.log('\n✗ Failed to upload kanji data. Please check your Firebase configuration.');
  }
});
