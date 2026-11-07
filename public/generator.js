/*
 * Trig Blitz problem generator.
 * Shared by the server (ranked games) and the browser (practice).
 *
 * Every answer is a whole number from 1 up, because players type digits only.
 * Angles are always answered in degrees.
 *
 * Every problem gets a normalized key, so the same problem is never handed out
 * twice in a game. A generator can also be given a list of keys to avoid (the
 * server passes each player's history).
 *
 * Each problem also carries a topic (`op`) so practice mode can filter:
 *   angles | values | triangles | inverse | identities
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlitzGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  const DEG = '°', MINUS = '−', TIMES = '×', DIV = '÷', ROOT = '√', PI = 'π';

  /* ================================================================ tier 1 */
  // 1 point: angle arithmetic and the easiest exact values.

  function complement() {
    const x = rint(5, 85);
    const text = Math.random() < 0.5 ? x + DEG + ' + ? = 90' + DEG : 'Complement of ' + x + DEG;
    return { op: 'angles', text: text, answer: 90 - x, key: 'comp|' + x };
  }
  function supplement() {
    let x = rint(11, 169); if (x === 90) x = 91;
    const text = Math.random() < 0.5 ? x + DEG + ' + ? = 180' + DEG : 'Supplement of ' + x + DEG;
    return { op: 'angles', text: text, answer: 180 - x, key: 'supp|' + x };
  }
  function thirdAngle() {
    let a, b;
    do { a = rint(15, 100); b = rint(15, 100); } while (a + b > 165);
    return { op: 'angles', text: a + DEG + ' + ' + b + DEG + ' + ? = 180' + DEG, answer: 180 - a - b,
      key: 'tri|' + Math.min(a, b) + '|' + Math.max(a, b) };
  }

  // Exact values that are whole numbers or halves. num/den is the value.
  const HALF = [{ name: 'sin 30' + DEG, num: 1, den: 2 }, { name: 'cos 60' + DEG, num: 1, den: 2 }];
  const ONE = [{ name: 'sin 90' + DEG, num: 1, den: 1 }, { name: 'cos 0' + DEG, num: 1, den: 1 }, { name: 'tan 45' + DEG, num: 1, den: 1 }];
  const BASIC = HALF.concat(ONE);

  function term(f, lo, hi) {
    const k = rint(Math.ceil(lo / f.den), Math.floor(hi / f.den));
    return { text: (k * f.den) + ' ' + TIMES + ' ' + f.name, val: k * f.num };
  }
  function basicValue() {
    const t = term(pick(BASIC), 12, 99);
    return { op: 'values', text: t.text, answer: t.val, key: t.text };
  }

  /* ================================================================ tier 2 */
  // 2 points: sums of exact values, right triangles, radians, arc functions.

  function sumTwo() {
    const a = term(pick(BASIC), 10, 60), b = term(pick(BASIC), 10, 60);
    const key = [a.text, b.text].sort().join(' + ');
    const first = Math.random() < 0.5 ? a : b, second = first === a ? b : a;
    return { op: 'values', text: first.text + ' + ' + second.text, answer: a.val + b.val, key: key };
  }

  // [opposite, adjacent, hypotenuse]; the first four are the friendly ones.
  const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41], [12, 35, 37],
    [11, 60, 61], [28, 45, 53], [33, 56, 65], [16, 63, 65], [48, 55, 73], [13, 84, 85], [36, 77, 85], [39, 80, 89], [65, 72, 97]];
  const SMALL = TRIPLES.slice(0, 4), BIG = TRIPLES.slice(4);

  function scaledTriple(list, maxHyp) {
    const t = pick(list);
    const k = rint(1, Math.max(1, Math.floor(maxHyp / t[2])));
    return { t: t, k: k, a: t[0] * k, b: t[1] * k, c: t[2] * k };
  }
  function hypFromLegs(list, maxHyp) {
    return function () {
      const s = scaledTriple(list, maxHyp);
      const swap = Math.random() < 0.5;
      const x = swap ? s.b : s.a, y = swap ? s.a : s.b;
      return { op: 'triangles', text: 'Legs ' + x + ' & ' + y + '. Hypotenuse = ?', answer: s.c,
        key: 'hyp|' + Math.min(x, y) + '|' + Math.max(x, y) };
    };
  }
  function legFromHyp(list, maxHyp) {
    return function () {
      const s = scaledTriple(list, maxHyp);
      const swap = Math.random() < 0.5;
      const known = swap ? s.b : s.a, other = swap ? s.a : s.b;
      return { op: 'triangles', text: 'Hypotenuse ' + s.c + ', leg ' + known + '. Other leg = ?', answer: other,
        key: 'leg|' + s.c + '|' + known };
    };
  }
  // sin = opp/hyp, cos = adj/hyp, tan = opp/adj. Given the ratio and one side, find another.
  function ratioSide(list, maxHyp) {
    return function () {
      const s = scaledTriple(list, maxHyp);
      const t = s.t;
      const fn = pick(['sin', 'cos', 'tan']);
      const pair = fn === 'sin' ? [['opp', t[0], s.a], ['hyp', t[2], s.c]]
        : fn === 'cos' ? [['adj', t[1], s.b], ['hyp', t[2], s.c]]
        : [['opp', t[0], s.a], ['adj', t[1], s.b]];
      const flip = Math.random() < 0.5;
      const given = pair[flip ? 1 : 0], want = pair[flip ? 0 : 1];
      const ratio = pair[0][1] + '/' + pair[1][1];
      return { op: 'triangles', text: fn + ' θ = ' + ratio + ', ' + given[0] + ' = ' + given[2] + '. ' + want[0] + ' = ?',
        answer: want[2], key: 'ratio|' + fn + '|' + ratio + '|' + given[0] + '|' + given[2] };
    };
  }
  function specialTriangle() {
    const k = rint(3, 60);
    const forms = [
      { text: '30-60-90: short leg ' + k + '. Hypotenuse = ?', answer: 2 * k },
      { text: '30-60-90: hypotenuse ' + (2 * k) + '. Short leg = ?', answer: k },
      { text: '30-60-90: long leg ' + k + ROOT + '3. Short leg = ?', answer: k },
      { text: '30-60-90: long leg ' + k + ROOT + '3. Hypotenuse = ?', answer: 2 * k },
      { text: '45-45-90: leg ' + k + ROOT + '2. Hypotenuse = ?', answer: 2 * k },
      { text: '45-45-90: hypotenuse ' + k + ROOT + '2. Leg = ?', answer: k }
    ];
    const f = pick(forms);
    return { op: 'triangles', text: f.text, answer: f.answer, key: f.text };
  }

  function radUnit() {
    const n = pick([2, 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 30, 36]);
    return { op: 'angles', text: PI + '/' + n + ' = ?' + DEG, answer: 180 / n, key: 'rad|1|' + n };
  }

  // arc functions of the special values, first quadrant, with an offset to keep it fresh
  const ARC1 = [
    ['arcsin', '1/2', 30], ['arcsin', ROOT + '2/2', 45], ['arcsin', ROOT + '3/2', 60], ['arcsin', '1', 90],
    ['arccos', '1/2', 60], ['arccos', ROOT + '2/2', 45], ['arccos', ROOT + '3/2', 30], ['arccos', '0', 90],
    ['arctan', ROOT + '3/3', 30], ['arctan', '1', 45], ['arctan', ROOT + '3', 60]
  ];
  function arcOffset() {
    const a = pick(ARC1), n = rint(11, 59);
    return { op: 'inverse', text: a[0] + '(' + a[1] + ') + ' + n + DEG, answer: a[2] + n, key: 'arco|' + a[0] + a[1] + '|' + n };
  }

  /* ================================================================ tier 3 */
  // 3 points: reference and coterminal angles, radians, quadrants, powers.

  function referenceAngle() {
    let x;
    do { x = rint(101, 719); } while (x % 90 === 0);
    const r = x % 360;
    const ref = r < 90 ? r : r < 180 ? 180 - r : r < 270 ? r - 180 : 360 - r;
    return { op: 'angles', text: 'Reference angle of ' + x + DEG, answer: ref, key: 'ref|' + x };
  }
  function coterminal() {
    let x;
    do { x = Math.random() < 0.5 ? rint(361, 1100) : -rint(1, 720); } while (x % 360 === 0);
    const ans = ((x % 360) + 360) % 360;
    const shown = (x < 0 ? MINUS : '') + Math.abs(x) + DEG;
    return { op: 'angles', text: 'Coterminal of ' + shown + ' in [0' + DEG + ', 360' + DEG + ')', answer: ans, key: 'cot|' + x };
  }
  const RAD3 = [];
  [[2, [3]], [3, [2, 4, 5]], [4, [3, 5, 7]], [5, [2, 3, 4, 6, 7, 8, 9]], [6, [5, 7, 11]],
    [9, [2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17]], [10, [3, 7, 9, 11, 13, 17, 19]], [12, [5, 7, 11, 13, 17, 19, 23]]]
    .forEach(function (e) { e[1].forEach(function (k) { RAD3.push([k, e[0]]); }); });
  function radians() {
    if (Math.random() < 0.3) {
      const n = pick([3, 4, 6]);
      const m = rint(2, 2 * n - 1);
      return { op: 'angles', text: (m * 180 / n) + DEG + ' = ? ' + TIMES + ' ' + PI + '/' + n, answer: m, key: 'radr|' + m + '|' + n };
    }
    const kn = pick(RAD3);
    return { op: 'angles', text: kn[0] + PI + '/' + kn[1] + ' = ?' + DEG, answer: 180 * kn[0] / kn[1], key: 'rad|' + kn[0] + '|' + kn[1] };
  }

  // sin/cos/tan of a special angle, solved for theta in a stated quadrant
  const MAG = { sin: { 30: '1/2', 45: ROOT + '2/2', 60: ROOT + '3/2' }, cos: { 30: ROOT + '3/2', 45: ROOT + '2/2', 60: '1/2' },
    tan: { 30: ROOT + '3/3', 45: '1', 60: ROOT + '3' } };
  const SIGN = { sin: [1, 1, -1, -1], cos: [1, -1, -1, 1], tan: [1, -1, 1, -1] }; // by quadrant
  const QNAME = ['QI', 'QII', 'QIII', 'QIV'];
  function quadrantSolve() {
    const fn = pick(['sin', 'cos', 'tan']), ref = pick([30, 45, 60]), q = rint(2, 4);
    const theta = [ref, 180 - ref, 180 + ref, 360 - ref][q - 1];
    const sign = SIGN[fn][q - 1] < 0 ? MINUS : '';
    return { op: 'inverse', text: fn + ' θ = ' + sign + MAG[fn][ref] + ' in ' + QNAME[q - 1], answer: theta, key: 'quad|' + fn + '|' + ref + '|' + q };
  }
  const ARC2 = [['arccos', MINUS + '1/2', 120], ['arccos', MINUS + ROOT + '2/2', 135], ['arccos', MINUS + ROOT + '3/2', 150], ['arccos', MINUS + '1', 180]];
  function arcObtuse() {
    const a = pick(ARC2);
    if (Math.random() < 0.5) return { op: 'inverse', text: a[0] + '(' + a[1] + ') = ?' + DEG, answer: a[2], key: 'arcob|' + a[1] };
    const n = rint(11, 59);
    return { op: 'inverse', text: a[0] + '(' + a[1] + ') + ' + n + DEG, answer: a[2] + n, key: 'arcob|' + a[1] + '|' + n };
  }
  function arcMult() {
    const a = pick(ARC1), k = pick([2, 3]);
    return { op: 'inverse', text: k + ' ' + TIMES + ' ' + a[0] + '(' + a[1] + ')', answer: k * a[2], key: 'arcm|' + k + a[0] + a[1] };
  }

  // n × (some exact expression worth num/den); n is a multiple of den
  function exprMaker(forms, lo, hi, topic) {
    return function () {
      const f = pick(forms);
      const x = f.x ? f.x() : 0;
      const k = rint(Math.ceil(lo / f.den), Math.floor(hi / f.den));
      const text = (k * f.den) + ' ' + TIMES + ' ' + f.t(x);
      return { op: topic, text: text, answer: k * f.num, key: text };
    };
  }
  const POWERS = [
    { t: function () { return 'sin² 30' + DEG; }, num: 1, den: 4 },
    { t: function () { return 'cos² 60' + DEG; }, num: 1, den: 4 },
    { t: function () { return 'sin² 60' + DEG; }, num: 3, den: 4 },
    { t: function () { return 'cos² 30' + DEG; }, num: 3, den: 4 },
    { t: function () { return pick(['sin', 'cos']) + '² 45' + DEG; }, num: 1, den: 2 },
    { t: function () { return 'tan² 30' + DEG; }, num: 1, den: 3 },
    { t: function () { return 'tan² 60' + DEG; }, num: 3, den: 1 },
    { t: function () { return 'sin 60' + DEG + ' ' + TIMES + ' cos 30' + DEG; }, num: 3, den: 4 },
    { t: function () { return 'sin 30' + DEG + ' ' + TIMES + ' cos 60' + DEG; }, num: 1, den: 4 },
    { t: function () { return 'tan 30' + DEG + ' ' + TIMES + ' tan 60' + DEG; }, num: 1, den: 1 },
    { t: function () { return 'sin 45' + DEG + ' ' + TIMES + ' cos 45' + DEG; }, num: 1, den: 2 }
  ];
  const IDENT3 = [
    { t: function (x) { return '(sin² ' + x + DEG + ' + cos² ' + x + DEG + ')'; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return 'sin ' + x + DEG + ' ' + TIMES + ' csc ' + x + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return 'cos ' + x + DEG + ' ' + TIMES + ' sec ' + x + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } }
  ];

  function triangleArea() {
    let a, b, c;
    do { a = rint(6, 40); b = rint(6, 40); c = pick([30, 150, 90]); } while ((c === 90 ? (a * b) % 2 : (a * b) % 4) !== 0);
    const area = c === 90 ? a * b / 2 : a * b / 4;
    return { op: 'triangles', text: 'Area: sides ' + a + ', ' + b + ', angle ' + c + DEG, answer: area,
      key: 'area|' + Math.min(a, b) + '|' + Math.max(a, b) + '|' + c };
  }
  const SIN_COS_PERIODS = [2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45];
  function periodSinCos() {
    const a = rint(2, 9), b = pick(SIN_COS_PERIODS), fn = pick(['sin', 'cos']);
    return { op: 'identities', text: 'Period of y = ' + a + ' ' + fn + '(' + b + 'x) = ?' + DEG, answer: 360 / b, key: 'per|' + fn + a + '|' + b };
  }

  /* ================================================================ tier 4 */
  // 4 points: laws of sines and cosines, big angles, identities, graphs.

  // c^2 = a^2 + b^2 - 2ab cos C, with a whole c, for C = 60 and C = 120
  const COSINE_LAW = [];
  for (let a = 3; a <= 45; a++) for (let b = a + 1; b <= 45; b++) {
    [[60, a * a + b * b - a * b], [120, a * a + b * b + a * b]].forEach(function (e) {
      const c = Math.round(Math.sqrt(e[1]));
      if (c * c === e[1]) COSINE_LAW.push([a, b, e[0], c]);
    });
  }
  function lawOfCosines() {
    const e = pick(COSINE_LAW);
    const swap = Math.random() < 0.5;
    const a = swap ? e[1] : e[0], b = swap ? e[0] : e[1];
    return { op: 'triangles', text: 'a = ' + a + ', b = ' + b + ', C = ' + e[2] + DEG + '. c = ?', answer: e[3],
      key: 'lc|' + e[0] + '|' + e[1] + '|' + e[2] };
  }
  // a / sin A = b / sin B with exact sides
  const SINE_LAW = [
    { A: 30, B: 90, a: function (k) { return '' + k; }, b: function (k) { return 2 * k; } },
    { A: 90, B: 30, a: function (k) { return '' + 2 * k; }, b: function (k) { return k; } },
    { A: 60, B: 90, a: function (k) { return k + ROOT + '3'; }, b: function (k) { return 2 * k; } },
    { A: 60, B: 30, a: function (k) { return k + ROOT + '3'; }, b: function (k) { return k; } },
    { A: 120, B: 30, a: function (k) { return k + ROOT + '3'; }, b: function (k) { return k; } },
    { A: 45, B: 90, a: function (k) { return k + ROOT + '2'; }, b: function (k) { return 2 * k; } },
    { A: 45, B: 30, a: function (k) { return k + ROOT + '2'; }, b: function (k) { return k; } },
    { A: 30, B: 45, a: function (k) { return k + ROOT + '2'; }, b: function (k) { return 2 * k; } }
  ];
  function lawOfSines() {
    const f = pick(SINE_LAW), k = rint(3, 60);
    const text = 'A = ' + f.A + DEG + ', B = ' + f.B + DEG + ', a = ' + f.a(k) + '. b = ?';
    return { op: 'triangles', text: text, answer: f.b(k), key: text };
  }

  // angles beyond one turn: only the ones that land on a whole value
  const BIG_BASE = [['sin', 30, 1, 2], ['sin', 150, 1, 2], ['sin', 90, 1, 1], ['cos', 60, 1, 2], ['cos', 300, 1, 2],
    ['cos', 0, 1, 1], ['tan', 45, 1, 1], ['tan', 225, 1, 1]];
  function bigAngle() {
    const b = pick(BIG_BASE), m = pick([-2, -1, 1, 2, 3]);
    const ang = b[1] + 360 * m;
    const shown = ang < 0 ? b[0] + '(' + MINUS + Math.abs(ang) + DEG + ')' : b[0] + ' ' + ang + DEG;
    const k = rint(Math.ceil(11 / b[3]), Math.floor(99 / b[3]));
    return { op: 'values', text: (k * b[3]) + ' ' + TIMES + ' ' + shown, answer: k * b[2], key: 'big|' + b[0] + ang + '|' + k };
  }
  const IDENT4 = [
    { t: function (x) { return 'sin ' + x + DEG + ' ' + TIMES + ' cos ' + x + DEG; }, num: 1, den: 4, x: function () { return pick([15, 75]); } },
    { t: function () { return '(sin² 60' + DEG + ' ' + MINUS + ' cos² 60' + DEG + ')'; }, num: 1, den: 2 },
    { t: function () { return '(cos² 30' + DEG + ' ' + MINUS + ' sin² 30' + DEG + ')'; }, num: 1, den: 2 },
    { t: function (x) { return 'sin ' + x + DEG + ' ' + DIV + ' cos ' + (90 - x) + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return 'cos ' + x + DEG + ' ' + DIV + ' sin ' + (90 - x) + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return 'tan ' + x + DEG + ' ' + TIMES + ' tan ' + (90 - x) + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return '(sec² ' + x + DEG + ' ' + MINUS + ' tan² ' + x + DEG + ')'; }, num: 1, den: 1, x: function () { return rint(11, 79); } },
    { t: function (x) { return '(1 + tan² ' + x + DEG + ') ' + TIMES + ' cos² ' + x + DEG; }, num: 1, den: 1, x: function () { return rint(11, 79); } }
  ];
  function maxMin() {
    const a = rint(2, 9), b = rint(2, 6), fn = pick(['sin', 'cos']);
    if (Math.random() < 0.5) {
      const c = rint(2, 60);
      return { op: 'identities', text: 'Max of y = ' + a + ' ' + fn + '(' + b + 'x) + ' + c, answer: a + c, key: 'max|' + fn + a + '|' + b + '|' + c };
    }
    const c = rint(a + 1, a + 60);
    return { op: 'identities', text: 'Min of y = ' + a + ' ' + fn + '(' + b + 'x) + ' + c, answer: c - a, key: 'min|' + fn + a + '|' + b + '|' + c };
  }
  const TAN_PERIODS = [2, 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 30, 36, 45];
  function periodTan() {
    const a = rint(1, 9), b = pick(TAN_PERIODS);
    return { op: 'identities', text: 'Period of y = ' + (a > 1 ? a + ' ' : '') + 'tan(' + b + 'x) = ?' + DEG, answer: 180 / b, key: 'pert|' + a + '|' + b };
  }
  const ARC_ALL = ARC1.concat(ARC2);
  function arcSum() {
    let a, b;
    do { a = pick(ARC_ALL); b = pick(ARC_ALL); } while (a === b);
    const ta = a[0] + '(' + a[1] + ')', tb = b[0] + '(' + b[1] + ')';
    return { op: 'inverse', text: ta + ' + ' + tb, answer: a[2] + b[2], key: [ta, tb].sort().join('+') };
  }

  /* ================================================================ tiers */
  // A player moves up a tier after enough correct answers.
  const TIERS = [
    { tier: 1, points: 1, from: 0, makers: [
      complement, supplement, thirdAngle, basicValue
    ] },
    { tier: 2, points: 2, from: 8, makers: [
      sumTwo, hypFromLegs(SMALL, 150), legFromHyp(SMALL, 150), ratioSide(SMALL, 150), specialTriangle, radUnit, arcOffset
    ] },
    { tier: 3, points: 3, from: 20, makers: [
      referenceAngle, coterminal, radians, quadrantSolve, arcObtuse, arcMult,
      exprMaker(POWERS, 12, 99, 'values'), exprMaker(IDENT3, 11, 99, 'identities'), triangleArea, periodSinCos
    ] },
    { tier: 4, points: 4, from: 35, makers: [
      lawOfCosines, lawOfSines, bigAngle, exprMaker(IDENT4, 12, 99, 'identities'),
      hypFromLegs(BIG, 100), legFromHyp(BIG, 100), ratioSide(BIG, 200), maxMin, periodTan, arcSum
    ] }
  ];

  function tierForSolved(solved) {
    let t = TIERS[0];
    for (const x of TIERS) if (solved >= x.from) t = x;
    return t;
  }

  /*
   * Draw one fresh problem from a list of makers.
   * `used` is a Set of keys already handed out (updated in place);
   * `avoid` is an optional Set of keys from earlier games.
   * If a maker's space is crowded it moves on to another maker, and only as
   * a last resort accepts a problem from `avoid` (never one from `used`).
   * Returns null if every maker is exhausted.
   */
  function draw(makers, used, avoid) {
    const order = makers.slice().sort(function () { return Math.random() - 0.5; });
    let fallback = null;
    for (let round = 0; round < 4; round++) {
      for (const make of order) {
        for (let i = 0; i < 60; i++) {
          const p = make();
          if (used.has(p.key)) continue;
          if (avoid && avoid.has(p.key)) { if (!fallback) fallback = p; continue; }
          used.add(p.key);
          return p;
        }
      }
    }
    if (fallback) { used.add(fallback.key); return fallback; }
    return null;
  }

  const ALL_MAKERS = [];
  for (const t of TIERS) for (const m of t.makers) ALL_MAKERS.push(m);

  // Build the pools for one ranked game: a separate queue per tier.
  function buildRankedPools(avoidKeys, sizes) {
    sizes = sizes || { 1: 45, 2: 50, 3: 55, 4: 160 };
    const used = new Set();
    const avoid = avoidKeys ? new Set(avoidKeys) : null;
    const pools = {};
    for (const t of TIERS) {
      pools[t.tier] = [];
      for (let i = 0; i < sizes[t.tier]; i++) {
        const p = draw(t.makers, used, avoid) || draw(ALL_MAKERS, used, null);
        if (!p) break;
        pools[t.tier].push({ text: p.text, answer: p.answer, key: p.key });
      }
    }
    return pools;
  }

  // Practice: pick topics and a level; problems never repeat in a session.
  const TOPICS = [
    { id: 'angles', label: 'Angles & radians' },
    { id: 'values', label: 'Exact values' },
    { id: 'triangles', label: 'Triangles' },
    { id: 'inverse', label: 'Inverse & quadrants' },
    { id: 'identities', label: 'Identities & graphs' }
  ];
  const LEVELS = { easy: [1, 2], medium: [2, 3], hard: [3, 4] };
  function practiceSource(topics, level) {
    const tiers = LEVELS[level] || LEVELS.medium;
    function makersFor(tierList) {
      const out = [];
      for (const t of TIERS) {
        if (tierList.indexOf(t.tier) === -1) continue;
        for (const m of t.makers) {
          const sample = m();
          if (topics.indexOf(sample.op) !== -1) out.push(m);
        }
      }
      return out;
    }
    let makers = makersFor(tiers);
    if (!makers.length) makers = makersFor([1, 2, 3, 4]);
    const used = new Set();
    let widened = false;
    return { next: function () {
      let p = draw(makers, used, null);
      // A narrow choice can run dry in a long session: first widen to the same
      // topics at every level, and only after that let old problems come back.
      if (!p && !widened) { widened = true; makers = makersFor([1, 2, 3, 4]); p = draw(makers, used, null); }
      if (!p) { used.clear(); p = draw(makers, used, null); }
      return p;
    } };
  }

  return { TIERS: TIERS, TOPICS: TOPICS, tierForSolved: tierForSolved, buildRankedPools: buildRankedPools, practiceSource: practiceSource };
});
