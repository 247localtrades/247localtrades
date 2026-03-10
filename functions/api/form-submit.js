// =============================================================================
// 247 Local Trades — Form Submit Handler
// Route: POST /api/form-submit
// Stack: Cloudflare Pages Function → Supabase → GHL (D-STACK-02)
// Version: 1.0 | March 2026
// =============================================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── CORS headers ────────────────────────────────────────────────────────────
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://247localtrades.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, corsHeaders);
  }

  // ── Validate required fields ─────────────────────────────────────────────────
  const { name, phone, zip, trade, service_type, lead_tier, source, source_detail, campaign_id, visitor_id } = body;

  if (!phone || !trade || !zip) {
    return jsonResponse({ ok: false, error: 'Missing required fields: phone, trade, zip' }, 422, corsHeaders);
  }

  const validTrades = ['hvac', 'plumbing', 'electrical', 'roofing'];
  if (!validTrades.includes(trade)) {
    return jsonResponse({ ok: false, error: `Invalid trade: ${trade}` }, 422, corsHeaders);
  }

  const validTiers = ['standard', 'premium', 'emergency'];
  const tier = validTiers.includes(lead_tier) ? lead_tier : 'standard';

  // ── Sanitize inputs ──────────────────────────────────────────────────────────
  const lead = {
    name:         sanitize(name, 100),
    phone:        sanitizePhone(phone),
    email:        sanitize(body.email, 255),
    zip:          sanitizeZip(zip),
    city:         sanitize(body.city, 100),
    state:        sanitize(body.state, 2),
    trade:        trade,
    service_type: sanitize(service_type, 100),
    lead_tier:    tier,
    source:       sanitize(source, 50) || 'form',
    source_detail:sanitize(source_detail, 255),
    campaign_id:  sanitize(campaign_id, 100),
    visitor_id:   sanitize(visitor_id, 50),
  };

  // ── D-PRICE-01: Determine lead price based on tier ───────────────────────────
  const leadPrice = getLeadPrice(trade, tier);

  // ── 1. Insert into Supabase ──────────────────────────────────────────────────
  let supabaseId = null;
  try {
    const supaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/captured_leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(lead),
    });

    if (supaRes.ok) {
      const rows = await supaRes.json();
      supabaseId = rows?.[0]?.id ?? null;
    } else {
      const err = await supaRes.text();
      console.error('Supabase insert error:', err);
      // Don't fail the request — still attempt GHL
    }
  } catch (e) {
    console.error('Supabase fetch error:', e.message);
  }

  // ── 2. Trigger GHL webhook ───────────────────────────────────────────────────
  let ghlOk = false;
  try {
    const ghlPayload = {
      // Contact fields
      firstName:    lead.name?.split(' ')[0] ?? '',
      lastName:     lead.name?.split(' ').slice(1).join(' ') ?? '',
      phone:        lead.phone,
      email:        lead.email ?? '',

      // Custom fields mapped to GHL contact fields
      customField: {
        zip:          lead.zip,
        city:         lead.city ?? '',
        state:        lead.state ?? 'FL',
        trade:        lead.trade,
        service_type: lead.service_type ?? '',
        lead_tier:    lead.lead_tier,
        lead_price:   leadPrice,
        source:       lead.source,
        source_detail:lead.source_detail ?? '',
        campaign_id:  lead.campaign_id ?? '',
        supabase_id:  String(supabaseId ?? ''),
      },

      // Tags for GHL workflow routing
      tags: buildTags(lead),
    };

    const ghlRes = await fetch(env.GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghlPayload),
    });

    ghlOk = ghlRes.ok;
    if (!ghlOk) {
      const err = await ghlRes.text();
      console.error('GHL webhook error:', err);
    }
  } catch (e) {
    console.error('GHL fetch error:', e.message);
  }

  // ── 3. Log to ghl_webhook_log in Supabase ────────────────────────────────────
  if (supabaseId) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/ghl_webhook_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          trigger_type: 'form_submit',
          lead_id:      supabaseId,
          trade:        lead.trade,
          zip:          lead.zip,
          ghl_status:   ghlOk ? 'sent' : 'failed',
          payload_hash: await hashPayload(lead),
        }),
      });
    } catch (e) {
      // Non-fatal — don't block response
      console.error('GHL log error:', e.message);
    }
  }

  // ── 4. Return response ───────────────────────────────────────────────────────
  if (!supabaseId && !ghlOk) {
    // Both failed — something is wrong with env vars or connectivity
    return jsonResponse({
      ok: false,
      error: 'Submission failed. Please call us directly.',
    }, 500, corsHeaders);
  }

  return jsonResponse({
    ok: true,
    id: supabaseId,
    tier,
    trade,
    // Return the right callback phone number for the thank-you page
    callbackPhone: getTradePhone(trade),
  }, 200, corsHeaders);
}

// ── OPTIONS preflight ──────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://247localtrades.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// =============================================================================
// HELPERS
// =============================================================================

function jsonResponse(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function sanitize(val, maxLen) {
  if (!val || typeof val !== 'string') return null;
  return val.trim().slice(0, maxLen) || null;
}

function sanitizePhone(val) {
  if (!val) return null;
  // Strip everything except digits
  const digits = val.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  return `(${ten.slice(0,3)}) ${ten.slice(3,6)}-${ten.slice(6)}`;
}

function sanitizeZip(val) {
  if (!val) return null;
  const digits = val.replace(/\D/g, '').slice(0, 5);
  return digits.length === 5 ? digits : null;
}

// D-PRICE-01: lead pricing table
function getLeadPrice(trade, tier) {
  const prices = {
    hvac:       { standard: 90,  premium: 150, emergency: 125 },
    plumbing:   { standard: 70,  premium: 115, emergency: 100 },
    electrical: { standard: 55,  premium: 100, emergency: 80  },
    roofing:    { standard: 130, premium: 185, emergency: 160 },
  };
  return prices[trade]?.[tier] ?? prices[trade]?.standard ?? 70;
}

// Per-trade phone numbers (CallRail tracked)
function getTradePhone(trade) {
  const phones = {
    hvac:       '(850) 403-9797',
    plumbing:   '(850) 403-9798',
    electrical: '(850) 403-9799',
    roofing:    '(850) 403-9800',
  };
  return phones[trade] ?? phones.hvac;
}

// Build GHL tags for workflow routing
function buildTags(lead) {
  const tags = [`trade:${lead.trade}`, `tier:${lead.lead_tier}`, `zip:${lead.zip}`];
  if (lead.lead_tier === 'emergency') tags.push('EMERGENCY');
  if (lead.campaign_id) tags.push(`campaign:${lead.campaign_id}`);
  if (lead.source === 'qr') tags.push('source:qr');
  if (lead.source === 'direct_mail') tags.push('source:direct_mail');
  return tags;
}

// Simple payload hash for dedup logging
async function hashPayload(lead) {
  const str = `${lead.phone}-${lead.trade}-${lead.zip}-${Date.now()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2,'0')).join('');
}
