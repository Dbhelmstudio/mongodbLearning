/* =====================================================================
   seed.js — deterministic "shop" database used by every lesson,
   exercise and the shell playground.

   shop.customers   500   int _id, embedded address, tier, tags
   shop.products    120   string _id (P001..), polymorphic attributes
   shop.orders     5000   ObjectId _id, embedded line items, status
   shop.reviews    2000   ObjectId _id, free text for text search
   shop.events     3000   clickstream events (time-series shaped)
   shop.employees    40   managerId hierarchy for $graphLookup
   ===================================================================== */
window.MM = window.MM || {};

MM.seed = function () {
  'use strict';
  var s = 20261008;
  function rnd() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    var t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function int(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function weighted(pairs) {
    var total = 0, i; for (i = 0; i < pairs.length; i++) total += pairs[i][1];
    var r = rnd() * total;
    for (i = 0; i < pairs.length; i++) { r -= pairs[i][1]; if (r <= 0) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  }
  function hex(n, len) { var h = n.toString(16); while (h.length < len) h = '0' + h; return h.slice(-len); }
  var oidCounter = 0x1a2b3c;
  function oid(date) {
    oidCounter = (oidCounter + 1) % 0xffffff;
    return hex(Math.floor(date.getTime() / 1000), 8) + hex(Math.floor(rnd() * 0xffffffff), 8) + hex(int(0, 255), 2) + hex(oidCounter, 6);
  }
  function dateBetween(a, b) { return new Date(a.getTime() + Math.floor(rnd() * (b.getTime() - a.getTime()))); }
  function round2(x) { return Math.round(x * 100) / 100; }

  var FIRST = ['Aarav','Diya','Rohan','Ananya','Vikram','Meera','Arjun','Isha','Kabir','Sara','Liam','Emma','Noah','Olivia','Mateo','Sofia','Yuki','Hana','Omar','Layla','Lucas','Mia','Ethan','Zara','Ravi','Priya','Daniel','Chloe','Ahmed','Nina'];
  var LAST = ['Sharma','Reddy','Iyer','Khan','Patel','Gupta','Nair','Singh','Smith','Garcia','Muller','Rossi','Tanaka','Kim','Silva','Brown','Wilson','Haddad','Costa','Novak'];
  var PLACES = [
    ['Hyderabad','India','500'], ['Bengaluru','India','560'], ['Mumbai','India','400'], ['Chennai','India','600'], ['Delhi','India','110'],
    ['Pune','India','411'], ['London','UK','EC1'], ['Manchester','UK','M1 '], ['New York','USA','100'], ['Austin','USA','787'],
    ['Seattle','USA','981'], ['Berlin','Germany','101'], ['Singapore','Singapore','018'], ['Dubai','UAE','000'], ['Sydney','Australia','200']
  ];
  var TIERS = [['bronze', 50], ['silver', 28], ['gold', 16], ['platinum', 6]];
  var CUST_TAGS = ['newsletter', 'early-adopter', 'b2b', 'student', 'loyalty', 'mobile-first', 'high-returns', 'vip-support'];

  var db = { customers: [], products: [], orders: [], reviews: [], events: [], employees: [] };

  /* ---------------- customers ---------------- */
  var i, j;
  for (i = 1; i <= 500; i++) {
    var fn = pick(FIRST), ln = pick(LAST), place = pick(PLACES);
    var signup = dateBetween(new Date('2022-01-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'));
    var c = {
      _id: i,
      name: fn + ' ' + ln,
      email: (fn + '.' + ln + i).toLowerCase() + '@example.com',
      tier: weighted(TIERS),
      address: { city: place[0], country: place[1], zip: place[2].trim() + String(int(0, 999)).padStart(3, '0') },
      signupDate: signup,
      marketingOptIn: rnd() < 0.62,
      tags: []
    };
    var nt = int(0, 3);
    for (j = 0; j < nt; j++) { var tg = pick(CUST_TAGS); if (c.tags.indexOf(tg) < 0) c.tags.push(tg); }
    if (rnd() < 0.8) c.phone = '+' + int(10, 99) + '-' + int(6000000000, 9999999999);
    if (rnd() < 0.05) c.deletedAt = dateBetween(signup, new Date('2026-09-30T00:00:00Z'));
    db.customers.push(c);
  }

  /* ---------------- products (polymorphic attributes) ---------------- */
  var CATS = {
    electronics: { names: ['Wireless Earbuds','4K Monitor','Mechanical Keyboard','USB-C Hub','Smart Watch','Bluetooth Speaker','Webcam HD','Portable SSD','Gaming Mouse','Noise Cancelling Headphones'], price: [15, 900] },
    books:       { names: ['Designing Data-Intensive Apps','MongoDB in Action','Clean Code','The Phoenix Project','Database Internals','Site Reliability Engineering','Refactoring','Kubernetes Patterns','Release It','Systems Performance'], price: [9, 70] },
    home:        { names: ['Coffee Grinder','Air Purifier','LED Desk Lamp','Ceramic Mug Set','Robot Vacuum','Electric Kettle','Standing Desk','Office Chair','Bookshelf','Throw Blanket'], price: [8, 650] },
    fashion:     { names: ['Running Shoes','Denim Jacket','Linen Shirt','Leather Wallet','Rain Jacket','Wool Sweater','Sneakers','Backpack','Sunglasses','Chinos'], price: [12, 220] },
    sports:      { names: ['Yoga Mat','Dumbbell Set','Cycling Helmet','Tennis Racket','Football','Resistance Bands','Jump Rope','Water Bottle','Trekking Poles','Swim Goggles'], price: [6, 300] },
    grocery:     { names: ['Arabica Coffee Beans','Green Tea','Dark Chocolate','Basmati Rice','Olive Oil','Almonds','Honey','Granola','Peanut Butter','Masala Chai'], price: [3, 40] }
  };
  var catNames = Object.keys(CATS), pnum = 0;
  catNames.forEach(function (cat) {
    for (var k = 0; k < 20; k++) {
      pnum++;
      var base = CATS[cat].names[k % 10], variant = k >= 10 ? ' Pro' : '';
      var p = {
        _id: 'P' + String(pnum).padStart(3, '0'),
        name: base + variant,
        category: cat,
        price: round2(CATS[cat].price[0] + rnd() * (CATS[cat].price[1] - CATS[cat].price[0])),
        stock: weighted([[0, 6], [int(1, 20), 30], [int(21, 500), 64]]),
        rating: round2(2.5 + rnd() * 2.5),
        tags: [cat],
        createdAt: dateBetween(new Date('2021-06-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z')),
        attributes: {}
      };
      if (cat === 'electronics') p.attributes = { brand: pick(['Sonix','Voltra','Pixelcraft','Nimbus']), warrantyMonths: pick([6, 12, 24]), wireless: rnd() < 0.6 };
      if (cat === 'books') p.attributes = { author: pick(['M. Kleppmann','K. Banker','R. Martin','G. Kim','A. Petrov','B. Beyer']), pages: int(180, 900), format: pick(['paperback','hardcover','ebook']) };
      if (cat === 'home') p.attributes = { material: pick(['steel','wood','ceramic','plastic']), powerWatts: rnd() < 0.5 ? int(20, 1800) : null };
      if (cat === 'fashion') p.attributes = { sizes: ['S','M','L','XL'].slice(0, int(2, 4)), color: pick(['black','navy','olive','white','tan']) };
      if (cat === 'sports') p.attributes = { weightKg: round2(0.1 + rnd() * 20), outdoor: rnd() < 0.5 };
      if (cat === 'grocery') p.attributes = { organic: rnd() < 0.4, shelfLifeDays: int(30, 720), weightGrams: pick([100, 250, 500, 1000]) };
      if (rnd() < 0.3) p.tags.push(pick(['bestseller','new','eco','limited','gift']));
      if (rnd() < 0.15) p.tags.push('sale');
      db.products.push(p);
    }
  });

  /* ---------------- orders (embedded line items) ---------------- */
  var STATUS = [['delivered', 52], ['shipped', 12], ['paid', 9], ['pending', 8], ['cancelled', 11], ['returned', 8]];
  var PAY = [['card', 45], ['upi', 30], ['wallet', 15], ['cod', 10]];
  var COUPONS = ['WELCOME10', 'FESTIVE20', 'FREESHIP', 'LOYAL15'];
  for (i = 0; i < 5000; i++) {
    /* The last 30 customers never order, so anti-join exercises have a real answer. */
    var cust = db.customers[Math.floor(Math.pow(rnd(), 1.6) * (db.customers.length - 30))];
    var created = dateBetween(new Date('2024-01-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
    if (created < cust.signupDate) created = dateBetween(cust.signupDate, new Date('2026-09-30T00:00:00Z'));
    var nItems = weighted([[1, 40], [2, 30], [3, 15], [4, 10], [5, 5]]);
    var items = [], used = {};
    /* Line items keep the price paid at purchase; catalog prices rose about 15% over the period. */
    var priceAtPurchase = 0.85 + 0.15 * (created - Date.UTC(2024, 0, 1)) / (Date.UTC(2026, 8, 30) - Date.UTC(2024, 0, 1));
    for (j = 0; j < nItems; j++) {
      var prod = pick(db.products);
      if (used[prod._id]) continue;
      used[prod._id] = 1;
      items.push({ productId: prod._id, name: prod.name, category: prod.category, qty: weighted([[1, 70], [2, 20], [3, 7], [5, 3]]), price: round2(prod.price * priceAtPurchase) });
    }
    var subtotal = 0;
    items.forEach(function (it) { subtotal += it.qty * it.price; });
    var status = weighted(STATUS);
    var o = {
      _id: oid(created),
      orderNo: 'ORD-' + (100001 + i),
      customerId: cust._id,
      status: status,
      createdAt: created,
      items: items,
      total: round2(subtotal),
      payment: { method: weighted(PAY), status: status === 'pending' ? 'awaiting' : (status === 'cancelled' ? 'refunded' : 'captured') },
      shipping: { city: cust.address.city, country: cust.address.country }
    };
    if (rnd() < 0.18) { o.couponCode = pick(COUPONS); o.discount = round2(o.total * 0.1); }
    if (status === 'delivered' || status === 'returned') o.deliveredAt = new Date(created.getTime() + int(1, 9) * 86400000);
    db.orders.push(o);
  }
  db.orders.sort(function (a, b) { return a.createdAt - b.createdAt; });

  /* ---------------- reviews (text) ---------------- */
  var POS = ['excellent quality and fast delivery', 'works perfectly, highly recommend', 'great value for money', 'battery life is amazing', 'comfortable and well made', 'arrived early and well packed', 'exactly as described', 'sturdy build and premium feel'];
  var NEG = ['stopped working after a week', 'poor packaging, item damaged', 'battery drains quickly', 'size runs small, had to return', 'customer support was slow', 'not worth the price', 'arrived late and scratched', 'cheap material, feels flimsy'];
  var MID = ['decent but could be better', 'okay for the price', 'delivery took longer than expected', 'good product, average packaging'];
  for (i = 0; i < 2000; i++) {
    var pr = pick(db.products), cu = pick(db.customers);
    var rating = weighted([[5, 38], [4, 27], [3, 14], [2, 9], [1, 12]]);
    var pool = rating >= 4 ? POS : (rating <= 2 ? NEG : MID);
    var when = dateBetween(new Date('2024-02-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
    var text = pick(pool) + '. ' + (rnd() < 0.5 ? pick(pool) + '.' : '') + (rnd() < 0.2 ? ' Would buy the ' + pr.name.toLowerCase() + ' again.' : '');
    db.reviews.push({
      _id: oid(when), productId: pr._id, customerId: cu._id, rating: rating,
      title: pick(pool).replace(/^./, function (x) { return x.toUpperCase(); }),
      body: text.trim(), helpfulVotes: weighted([[0, 50], [int(1, 5), 35], [int(6, 60), 15]]),
      verifiedPurchase: rnd() < 0.78, createdAt: when
    });
  }
  db.reviews.sort(function (a, b) { return a.createdAt - b.createdAt; });

  /* ---------------- events (clickstream) ---------------- */
  var ETYPES = [['page_view', 55], ['search', 15], ['add_to_cart', 15], ['checkout', 8], ['purchase', 5], ['error', 2]];
  for (i = 0; i < 3000; i++) {
    var ts = dateBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T23:59:59Z'));
    var et = weighted(ETYPES);
    var ev = { ts: ts, type: et, customerId: rnd() < 0.15 ? null : int(1, 500), sessionId: 'S' + hex(int(0, 0xfffff), 5),
               device: weighted([['mobile', 60], ['desktop', 32], ['tablet', 8]]), latencyMs: int(20, 900) };
    if (et === 'search') ev.query = pick(['headphones','coffee','yoga mat','monitor','backpack','green tea','keyboard','running shoes']);
    if (et === 'add_to_cart' || et === 'purchase') ev.productId = pick(db.products)._id;
    if (et === 'error') { ev.code = pick([500, 502, 504, 429]); ev.latencyMs = int(900, 5000); }
    ev._id = oid(ts);
    db.events.push(ev);
  }
  db.events.sort(function (a, b) { return a.ts - b.ts; });

  /* ---------------- employees (hierarchy) ---------------- */
  var DEPTS = ['Engineering', 'Operations', 'Sales', 'Support'];
  db.employees.push({ _id: 1, name: 'Meera Iyer', title: 'CEO', dept: 'Executive', managerId: null, salary: 420000, hiredAt: new Date('2018-04-01T00:00:00Z'), skills: ['strategy'] });
  for (i = 2; i <= 5; i++) db.employees.push({ _id: i, name: pick(FIRST) + ' ' + pick(LAST), title: 'VP ' + DEPTS[i - 2], dept: DEPTS[i - 2], managerId: 1, salary: int(220000, 300000), hiredAt: dateBetween(new Date('2018-06-01T00:00:00Z'), new Date('2020-12-31T00:00:00Z')), skills: ['leadership'] });
  for (i = 6; i <= 13; i++) db.employees.push({ _id: i, name: pick(FIRST) + ' ' + pick(LAST), title: 'Manager', dept: DEPTS[(i - 6) % 4], managerId: 2 + (i - 6) % 4, salary: int(140000, 200000), hiredAt: dateBetween(new Date('2019-01-01T00:00:00Z'), new Date('2023-12-31T00:00:00Z')), skills: ['hiring', pick(['mongodb', 'kubernetes', 'negotiation', 'support-ops'])] });
  var SK = ['mongodb', 'postgresql', 'kubernetes', 'terraform', 'python', 'go', 'typescript', 'sales', 'support', 'linux'];
  for (i = 14; i <= 40; i++) {
    var mgr = int(6, 13), dept = db.employees[mgr - 1].dept, sk = [];
    for (j = 0; j < int(1, 3); j++) { var x = pick(SK); if (sk.indexOf(x) < 0) sk.push(x); }
    db.employees.push({ _id: i, name: pick(FIRST) + ' ' + pick(LAST), title: pick(['Engineer', 'Senior Engineer', 'Analyst', 'Specialist']), dept: dept, managerId: mgr, salary: int(60000, 150000), hiredAt: dateBetween(new Date('2020-01-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z')), skills: sk });
  }

  return db;
};
