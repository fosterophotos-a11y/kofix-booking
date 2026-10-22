const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SECRET = process.env.ADMIN_TOKEN_SECRET || '';

// Packages exactly as printed on the sample flyer: [category, [[shots, includes, regular, promo], ...]]
const E = 'Any additional outfit beyond the package limit costs GHS 20 per outfit.';
const FLYER = [
  ['Studio Shoot', [[5,'1 outfit',250,200],[8,'2 outfits',400,320],[10,'3 outfits',550,440],[13,'4 outfits',750,600]]],
  ['Outdoor Shoot', [[5,'1 outfit',500,400],[10,'2 outfits',700,560],[12,'3 outfits',900,720],[15,'4 outfits',1200,960]]],
  ['Studio Babies Shoot', [[4,'1 outfit',230,270],[8,'2 outfits',350,280],[10,'3 outfits',550,440],[13,'1 frame 12x16',750,600]]],
  ['Babies Shoot Outdoor', [[4,'1 outfit',350,280],[8,'2 outfits',570,600],[11,'3 outfits',800,740],[15,'1 frame 12x16',1200,960]]],
  ['Pre-Wedding Shoot Studio', [[4,'1 outfit',400,330],[6,'2 outfits',550,380],[10,'3 outfits',700,550],[13,'1 frame 12x16',850,750]]],
  ['Pre-Wedding Shoot Outdoor', [[6,'1 outfit',550,440],[8,'2 outfits',700,560],[10,'3 outfits',830,665],[12,'1 frame 12x16',950,850]]],
  ['Family Shot Studio', [[5,'1 outfit',600,480],[9,'2 outfits',850,680],[14,'3 outfits',1200,960],[16,'4 outfits',1600,1280]]],
  ['Family Shot Outdoor', [[6,'1 outfit',850,680],[11,'2 outfits',1200,960],[14,'3 outfits',1500,1200],[25,'4 outfits',2000,1600]]],
  ['Maternity Shoot Studio', [[3,'1 outfit',200,160],[6,'2 outfits',400,320],[8,'3 outfits',650,520],[10,'1 frame 12x16',899,720]]],
  ['Maternity Shoot Outdoor', [[4,'1 outfit',350,280],[8,'2 outfits',570,600],[11,'3 outfits',800,740],[13,'1 frame 12x16',1100,880]]],
  ['Graduation Shot Studio', [[4,'',300,240],[6,'',400,320],[8,'',750,580],[10,'',850,740]]],
  ['Graduation Shot Outdoor', [[6,'',400,320],[11,'',560,450],[13,'',860,690],[15,'',1000,800]]],
];

const MSG = {
  PROMO_FULL: 'PROMO FULL — ALL 6 SLOTS BOOKED',
  DUPLICATE: 'You already have an active booking request for this package with this phone number.',
  PACKAGE_UNAVAILABLE: 'This package is not available right now.',
  PAYMENT_REQUIRED: 'Payment status does not meet the confirmation rule. Update payment first.',
  NOT_CONFIRMABLE: 'A cancelled or refunded booking cannot be confirmed.',
  NOT_FOUND: 'Booking not found.',
  UNAUTHORIZED: 'Please log in again.',
};
const res = (s, b, h = {}) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }, body: JSON.stringify(b) });
const bad = (m) => { throw new Error('VALIDATION:' + m); };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const same = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };

function auth(e) {
  const t = (e.headers.authorization || '').replace('Bearer ', '');
  const [exp, mac] = t.split('.');
  if (!SECRET || !exp || !mac || Date.now() > +exp || !same(sign(exp), mac)) throw new Error('UNAUTHORIZED');
}
const admin = (fn) => async (b, e) => { auth(e); return fn(b, e); };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

async function notify(subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL) return false;   // not configured: do nothing, claim nothing
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Kofix Bookings <onboarding@resend.dev>', to: [process.env.NOTIFY_EMAIL], subject, text }) });
    return r.ok;
  } catch { return false; }
}

async function counts() {
  const rows = must(await sb.from('bookings').select('package_id,slot_no,name').eq('status', 'confirmed'));
  const c = {}, s = {};
  rows.forEach((r) => { c[r.package_id] = (c[r.package_id] || 0) + 1; (s[r.package_id] ||= {})[r.slot_no] = r.name; });
  return { c, s };
}

const routes = {
  async packages() {
    const pk = must(await sb.from('packages').select('*').eq('active', true).order('sort').order('created_at'));
    const st = must(await sb.from('settings').select('confirm_rule,deposit_amount,payment_instructions').eq('id', 1).single());
    const { c } = await counts();
    return { packages: pk.map((p) => ({ ...p, booked: c[p.id] || 0 })), settings: st };
  },

  async book(b) {
    const name = clean(b.name, 80), phone = clean(b.phone, 20), email = clean(b.email, 120);
    if (name.length < 2) bad('Please enter your full name.');
    if (!/^\+?[\d\s-]{9,18}$/.test(phone)) bad('Please enter a valid WhatsApp / phone number.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Email address looks invalid.');
    if (!/^[0-9a-f-]{36}$/.test(b.package_id || '')) bad('Choose a package.');
    let date = clean(b.pref_date, 10) || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10))) bad('Preferred date must be today or later.');
    const row = must(await sb.rpc('create_booking', { p_package: b.package_id, p_name: name, p_phone: phone, p_email: email || null,
      p_date: date, p_location: clean(b.location, 160), p_notes: clean(b.notes, 600) }));
    const pk = must(await sb.from('packages').select('name').eq('id', b.package_id).single());
    await notify(`New booking request ${row.ref}`, `${name} (${phone}) requested "${pk.name}". Ref ${row.ref}. Status: pending, payment: unpaid. Slot is assigned when you confirm it in the dashboard.`);
    return { ref: row.ref, status: row.status, payment_status: row.payment_status, package: pk.name };
  },

  async status(b) {
    const ref = clean(b.ref, 20).toUpperCase(), phone = clean(b.phone, 20);
    const r = must(await sb.from('bookings').select('ref,status,payment_status,slot_no,phone,packages(name)').eq('ref', ref).maybeSingle());
    if (!r || r.phone.replace(/\D/g, '').slice(-9) !== phone.replace(/\D/g, '').slice(-9)) throw new Error('NOT_FOUND');
    return { ref: r.ref, status: r.status, payment_status: r.payment_status, slot_no: r.status === 'confirmed' ? r.slot_no : null, package: r.packages.name };
  },

  async login(b) {
    if (!process.env.ADMIN_PASSWORD || !SECRET || !same(String(b.password || ''), process.env.ADMIN_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 800)); throw new Error('UNAUTHORIZED');
    }
    const exp = String(Date.now() + 12 * 3600e3);
    return { token: exp + '.' + sign(exp) };
  },

  list: admin(async () => {
    const bookings = must(await sb.from('bookings').select('*,packages(name,category)').order('created_at', { ascending: false }).limit(2000));
    const packages = must(await sb.from('packages').select('*').order('sort').order('created_at'));
    const settings = must(await sb.from('settings').select('*').eq('id', 1).single());
    const { c, s } = await counts();
    return { bookings, packages: packages.map((p) => ({ ...p, booked: c[p.id] || 0, slots: s[p.id] || {} })), settings,
      unseen: bookings.filter((x) => !x.admin_seen).length };
  }),
  confirm: admin(async (b) => ({ booking: must(await sb.rpc('confirm_booking', { p_id: b.id })) })),
  setstatus: admin(async (b) => {
    if (!['cancelled', 'refunded', 'pending'].includes(b.status)) bad('Invalid status');
    const u = { status: b.status, slot_no: null, confirmed_at: null };
    if (b.status === 'refunded') u.payment_status = 'refunded';
    return { booking: must(await sb.from('bookings').update(u).eq('id', b.id).select().single()) };
  }),
  pay: admin(async (b) => {
    if (!['unpaid', 'deposit_paid', 'paid', 'refunded'].includes(b.payment_status)) bad('Invalid payment status');
    return { booking: must(await sb.from('bookings').update({ payment_status: b.payment_status }).eq('id', b.id).select().single()) };
  }),
  seen: admin(async () => { must(await sb.from('bookings').update({ admin_seen: true }).eq('admin_seen', false)); return { ok: true }; }),
  savepkg: admin(async (b) => {
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const row = { category: clean(b.category, 80), name: clean(b.name, 120), shots: num(b.shots), includes: clean(b.includes, 120),
      regular_price: num(b.regular_price), promo_price: num(b.promo_price), description: clean(b.description, 800),
      terms: clean(b.terms, 800), photo: clean(b.photo, 300), active: !!b.active, sort: num(b.sort) || 0 };
    if (!row.name || !row.category) bad('Category and name are required.');
    const q = b.id ? sb.from('packages').update(row).eq('id', b.id) : sb.from('packages').insert(row);   // new package => its own 6 slots automatically
    return { package: must(await q.select().single()) };
  }),
  delpkg: admin(async (b) => {
    const { count } = await sb.from('bookings').select('id', { count: 'exact', head: true }).eq('package_id', b.id);
    if (count) { must(await sb.from('packages').update({ active: false }).eq('id', b.id)); return { deactivated: true }; }
    must(await sb.from('packages').delete().eq('id', b.id)); return { deleted: true };
  }),
  importflyer: admin(async () => {
    const have = new Set(must(await sb.from('packages').select('name')).map((p) => p.name));
    const rows = []; let sort = 0;
    for (const [cat, tiers] of FLYER) for (const [shots, inc, reg, promo] of tiers) {
      const name = `${cat} — ${shots} Shoots`; sort++;
      if (!have.has(name)) rows.push({ category: cat, name, shots, includes: inc, regular_price: reg, promo_price: promo, terms: E, sort });
    }
    if (rows.length) must(await sb.from('packages').insert(rows));
    return { added: rows.length, skipped: sort - rows.length };
  }),
  savesettings: admin(async (b) => {
    if (!['manual', 'deposit', 'full'].includes(b.confirm_rule)) bad('Invalid rule');
    must(await sb.from('settings').update({ confirm_rule: b.confirm_rule, deposit_amount: clean(b.deposit_amount, 60),
      payment_instructions: clean(b.payment_instructions, 1200) }).eq('id', 1));
    return { ok: true };
  }),
};

exports.handler = async (e) => {
  const a = (e.queryStringParameters || {}).a;
  const fn = routes[a];
  if (!fn) return res(404, { error: 'NOT_FOUND', message: 'Unknown action' });
  let body = {}; try { body = e.body ? JSON.parse(e.body) : {}; } catch { return res(400, { error: 'VALIDATION', message: 'Bad request' }); }
  try { return res(200, await fn(body, e)); }
  catch (err) {
    const m = String(err.message || err);
    if (m.startsWith('VALIDATION:')) return res(400, { error: 'VALIDATION', message: m.slice(11) });
    const code = Object.keys(MSG).find((k) => m.includes(k));
    if (code) return res(code === 'UNAUTHORIZED' ? 401 : 409, { error: code, message: MSG[code] });
    console.error(m); return res(500, { error: 'SERVER', message: 'Something went wrong. Please try again.' });
  }
};
