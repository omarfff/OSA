import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const SELF = "https://pkctqxeydfuiupadaoov.supabase.co/functions/v1/osa-pay";
const PILOT = "https://pkctqxeydfuiupadaoov.supabase.co/functions/v1/osa-pilot-usdc";
const X402 = "https://pkctqxeydfuiupadaoov.supabase.co/functions/v1/osa-x402";
const PRODUCT = Object.freeze({
  id: "mcp_reliability_pilot_30d",
  sku: "OSA-MCP-RELIABILITY-30D",
  name: "OSA 30-Day MCP Reliability Pilot",
  amount: 79,
  currency: "USD",
});
const H = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: H });
function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}
function emailOk(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function uuidOk(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function optionalHttps(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 500) throw new Error("invalid_endpoint");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("invalid_endpoint");
  return url.toString();
}

async function invoiceRequest(req: Request, sql: any) {
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 8192) return json({ ok: false, error: "body_too_large" }, 413);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);
  if (String(body.website || "").trim()) return json({ ok: true, status: "invoice_requested", payment_status: "not_paid" }, 202);
  if (String(body.action || "") !== "invoice_request") return json({ ok: false, error: "unsupported_action" }, 400);

  const email = String(body.email || "").trim().toLowerCase();
  const company = String(body.company || "").trim().slice(0, 120) || null;
  const opportunityId = String(body.opportunity_id || "").trim();
  if (!emailOk(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (opportunityId && !uuidOk(opportunityId)) return json({ ok: false, error: "invalid_opportunity_id" }, 400);
  let endpoint: string | null;
  try { endpoint = optionalHttps(body.endpoint); }
  catch { return json({ ok: false, error: "invalid_endpoint" }, 400); }

  const details = {
    product_id: PRODUCT.id,
    sku: PRODUCT.sku,
    amount: PRODUCT.amount,
    currency: PRODUCT.currency,
    requested_method: "invoice_bank_transfer",
    payment_status: "not_paid",
    public_bank_details_shared: false,
    opportunity_id: opportunityId || null,
    requested_at: new Date().toISOString(),
  };
  const rows = await sql`
    insert into public.leads as existing(email, plan, source, endpoint, company, details, status)
    values(${email}, 'pilot-30d', 'osa-pay', ${endpoint}, ${company}, ${sql.json(details)}, 'invoice_requested')
    on conflict(email) do update set
      plan='pilot-30d',
      source='osa-pay',
      endpoint=coalesce(excluded.endpoint, existing.endpoint),
      company=coalesce(excluded.company, existing.company),
      details=coalesce(existing.details, '{}'::jsonb) || excluded.details,
      status='invoice_requested'
    returning id, status, created_at`;
  return json({
    ok: true,
    request_id: rows[0].id,
    status: rows[0].status,
    payment_status: "not_paid",
    product: PRODUCT,
    next: "Private invoice and bank-transfer instructions can now be prepared for this buyer.",
    truth: "This records a payment request only. It is not revenue and does not authorize fulfillment.",
  }, 202);
}

function publicOptions(rails: any[]) {
  const byKey = Object.fromEntries(rails.map((rail: any) => [rail.rail_key, rail]));
  const usdc = byKey.pilot_usdc;
  const invoice = byKey.bank_invoice;
  const machine = rails.filter((rail: any) => rail.audience === "machine" && rail.enabled && rail.production_ready);
  return {
    ok: true,
    service: "OSA Customer Checkout",
    version: "3.0.0",
    product: PRODUCT,
    recommended_for_humans: "invoice_request",
    instant_option: "pilot_usdc",
    customer_methods: [
      {
        rail: "invoice_request",
        label: "Invoice / bank transfer",
        status: invoice?.enabled && invoice?.production_ready ? "request_ready" : "unavailable",
        endpoint: SELF,
        public_bank_details: false,
      },
      {
        rail: "pilot_usdc",
        label: "Pay with a crypto wallet",
        status: usdc?.enabled && usdc?.production_ready ? "ready" : "unavailable",
        asset: "USDC",
        networks: usdc?.networks || [],
        endpoint: usdc?.endpoint_url || PILOT,
        compatible_wallet_examples: ["Coinbase Wallet", "MetaMask", "Trust Wallet", "Binance Wallet"],
      },
    ],
    inactive_methods: {
      card: "not_live",
      apple_pay: "not_live",
      mada: "not_live",
      tap: "disabled_by_owner",
    },
    machine,
    truth: "A request or wallet action is not revenue. Fulfillment requires independently verified settlement evidence.",
  };
}

function page(options: ReturnType<typeof publicOptions>) {
  const usdc = options.customer_methods.find((method: any) => method.rail === "pilot_usdc");
  const invoice = options.customer_methods.find((method: any) => method.rail === "invoice_request");
  const walletChips = (usdc?.compatible_wallet_examples || []).map((name: string) => `<span class="chip">${esc(name)}</span>`).join("");
  const networkChips = (usdc?.networks || []).map((name: string) => `<span class="chip">${esc(name)}</span>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OSA Checkout — 30-Day MCP Reliability Pilot</title><meta name="description" content="Choose invoice or a verified USDC wallet route for the $79 OSA 30-Day MCP Reliability Pilot."><style>:root{color-scheme:dark;--bg:#07111f;--card:#0e1d2e;--line:#294661;--text:#f5f8fb;--muted:#a9bdcf;--green:#63e6aa;--amber:#ffd277}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#183653 0,var(--bg) 46%);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.wrap{width:min(980px,calc(100% - 32px));margin:auto;padding:28px 0 70px}.nav{display:flex;justify-content:space-between;align-items:center}.brand{font-weight:950;letter-spacing:.14em}.pill,.chip{border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:#c8d8e7;font-size:12px}.hero{padding:58px 0 28px;text-align:center}.eyebrow{color:var(--green);font-weight:900;text-transform:uppercase;letter-spacing:.14em;font-size:12px}.hero h1{font-size:clamp(38px,7vw,68px);line-height:1;margin:14px auto;max-width:820px;letter-spacing:-.045em}.hero p{color:var(--muted);font-size:18px;max-width:700px;margin:0 auto}.price{font-size:44px;font-weight:950;margin-top:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px}.card{background:linear-gradient(180deg,rgba(18,36,55,.97),rgba(11,23,37,.97));border:1px solid var(--line);border-radius:18px;padding:26px}.card h2{margin:0 0 8px}.status{float:right;border-radius:999px;padding:5px 8px;background:#123c2d;color:#73f2b9;font-size:10px;font-weight:900}.muted{color:var(--muted)}.chips{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.btn{width:100%;border:1px solid var(--line);border-radius:12px;padding:13px 15px;font-weight:900;cursor:pointer;text-decoration:none;text-align:center;display:block;background:var(--green);color:#062016}.btn.secondary{background:#12263a;color:var(--text)}label{display:block;font-size:12px;color:#bdd0e1;margin-top:10px}input{width:100%;background:#08121e;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:12px 13px;margin-top:5px}.result{display:none;margin-top:12px;padding:12px;border-radius:10px;background:#08121e;white-space:pre-wrap}.truth{margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:16px;color:var(--muted);font-size:13px}.pending{color:var(--amber)}.machine{margin-top:14px;font-size:12px;color:var(--muted)}.machine a{color:#d8e8f7}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:42px}.card{padding:20px}}</style></head><body><main class="wrap"><nav class="nav"><div class="brand">OSA</div><div class="pill">One product · multiple ways to pay</div></nav><section class="hero"><div class="eyebrow">30-Day MCP Reliability Pilot</div><h1>Choose how you want to pay.</h1><p>The same $79 pilot and the same deliverables, whether your company needs an invoice or you prefer an instant wallet payment.</p><div class="price">$79</div></section><section class="grid"><article class="card"><span class="status">${invoice?.status === "request_ready" ? "READY" : "UNAVAILABLE"}</span><h2>Invoice / bank transfer</h2><p class="muted">Best for companies and buyers who do not use crypto. Bank details are shared privately, never published on this page.</p><form id="invoiceForm"><input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><label>Work email<input id="invoiceEmail" type="email" autocomplete="email" required placeholder="you@company.com"></label><label>Company (optional)<input id="company" maxlength="120" placeholder="Company name"></label><label>MCP endpoint (optional)<input id="endpoint" type="url" placeholder="https://your-mcp.example"></label><button class="btn" type="submit">Request the $79 invoice</button></form><div id="invoiceResult" class="result"></div></article><article class="card"><span class="status">${usdc?.status === "ready" ? "LIVE" : "UNAVAILABLE"}</span><h2>Pay with your wallet</h2><p class="muted">Use your existing wallet or exchange account. OSA does not create, hold, or control a customer wallet.</p><div class="chips">${networkChips}</div><div class="chips">${walletChips}</div><a class="btn secondary" href="${esc(usdc?.endpoint || PILOT)}" rel="noopener">Open verified USDC checkout</a><p class="machine">AI agent? <a href="${X402}?q=mcp" rel="noopener">Use the x402 endpoint</a>.</p></article></section><div class="truth"><b>Payment truth:</b> an invoice request, wallet connection, page view, or submitted transaction hash is not revenue. OSA starts fulfillment only after independent settlement verification. <span class="pending">Card, Mada, and Apple Pay are not shown as live until a verified merchant rail exists.</span></div></main><script>const form=document.getElementById('invoiceForm'),out=document.getElementById('invoiceResult'),params=new URLSearchParams(location.search);form.addEventListener('submit',async(e)=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;button.textContent='Submitting…';try{const response=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'invoice_request',email:document.getElementById('invoiceEmail').value,company:document.getElementById('company').value,endpoint:document.getElementById('endpoint').value,opportunity_id:params.get('opportunity_id')||'',website:form.elements.website.value})});const data=await response.json();out.style.display='block';out.textContent=response.ok?'Invoice request recorded. Reference: '+data.request_id+'\nNo payment has been recorded yet.':(data.error||'request_failed');}catch(_error){out.style.display='block';out.textContent='request_failed';}finally{button.disabled=false;button.textContent='Request the $79 invoice';}});</script></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return json({ ok: false, error: "db_unavailable" }, 500);
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    if (req.method === "POST") return await invoiceRequest(req, sql);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ ok: false, error: "method_not_allowed" }, 405);
    const rails = await sql`select rail_key,audience,provider,method,asset,networks,endpoint_url,enabled,production_ready,priority,proof_type,status_reason,capabilities,metadata,last_verified_at from osa_payments.rails order by priority,rail_key`;
    const options = publicOptions(rails);
    const url = new URL(req.url);
    if (url.pathname.endsWith("/options") || url.searchParams.get("format") === "json") return json(options);
    const html = page(options);
    return new Response(req.method === "HEAD" ? null : html, {
      status: 200,
      headers: {
        ...H,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    console.error("osa_pay_error", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "payment_router_unavailable" }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
