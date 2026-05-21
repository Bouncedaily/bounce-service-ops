export const config = { schedule: "*/5 * * * *" };

const METABASE_BIKE_URL = "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/6593b97e-9e7f-4614-9952-f1078631beb2/query/json";
const METABASE_JC_URL   = "https://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/d44b48d4-0353-4141-b1a5-aabd0254815f/query/json";
const SUPABASE_URL = "https://jpypnrrjiagscqrucslw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpweXBucnJqaWFnc2NxcnVjc2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNDU2NDAsImV4cCI6MjA5NDkyMTY0MH0.fesCaEsgS7r4Z6mV5S1-z54etaGNPpYlISdjjcnLfzM";

const SB = (path, opts={}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: opts.prefer||"resolution=merge-duplicates,return=minimal" },
  method: opts.method||"GET", body: opts.body, signal: AbortSignal.timeout(28000),
});

const clean = v => (v===""||v==null?null:v);
const toInt = v => { try { return v!=null?parseInt(v):null; } catch { return null; } };
const toNum = v => { try { return v!=null?parseFloat(v):null; } catch { return null; } };

const mapBike = b => ({
  reg_number: clean(b["Reg_Number"]), chassis_number: clean(b["Chassis Number"]),
  city: clean(b["City"]), hub_name: clean(b["Hub name"]),
  model_name: clean(b["Model Name"]), model: clean(b["Model Name"]),
  bike_status: clean(b["Status"]), status: b["Status"]==="Active_rental"?"active":"inactive",
  oos_sub_status: clean(b["OOS Sub Status"]), engine_number: clean(b["Engine Number"]),
  current_odometer: toInt(b["Current Odometer"]), odometer_bucket: clean(b["Odometer Bucket"]),
  pm_status: clean(b["PM Status"]), current_rider_name: clean(b["Current Rider Name"]),
  current_rider_phone: clean(b["Current Rider Phone"]),
  vehicle_serviced_since_days: toInt(b["Vehicle Serviced Since (Days)"]),
  latest_oos_date: clean(b["Latest OOS Date"]), latest_rfd_date: clean(b["Latest RFD Date"]),
  latest_running_repair_date: clean(b["Latest Running Repair Date"]),
  submission_type: clean(b["Submission Type"]), repair_category: clean(b["Repair Category"]),
  diu_update: clean(b["DIU Update"]), bike_id: toInt(b["Bike ID"]),
  first_deployment_date: clean(b["1st Deployment Date"]),
});

const mapJC = r => ({
  job_card_number: clean(r["Job Card Number"]),
  dms_jc_id: r["DMS JC ID"]!=null?String(r["DMS JC ID"]):null,
  reg_number: clean(r["Reg Number"]), city: clean(r["City"]), hub_name: clean(r["Hub Name"]),
  current_jc_status: clean(r["Current JC Status"]), parts_to_be_changed: clean(r["Parts to be Changed"]),
  technician_name: clean(r["Technician Name"]), reason_for_ending: clean(r["Reason for Ending"]),
  overall_tat_days: toNum(r["Overall TAT (Days)"]), submission_type: clean(r["Submission Type"]),
  labour_time_hours: toNum(r["Labour Time (Hours)"]),
  job_card_opened_date: clean(r["Job Card Opened Date"]), job_card_billed_date: clean(r["Job Card Billed Date"]),
  bike_status: clean(r["Bike Status"]), synced_at: new Date().toISOString(),
});

async function upsert(table, records, conflict) {
  let ok=0, err=0;
  for (let i=0; i<records.length; i+=500) {
    const r = await SB(`${table}?on_conflict=${conflict}`, { method:"POST", body:JSON.stringify(records.slice(i,i+500)) });
    r.ok||r.status===204 ? ok+=Math.min(500,records.length-i) : err+=Math.min(500,records.length-i);
  }
  return {ok,err};
}

async function deleteBilledJCs(freshKeys) {
  if (freshKeys.size < 50) return 0;
  const r = await SB("draft_jc?select=job_card_number");
  if (!r.ok) return 0;
  const existing = await r.json();
  const stale = existing.map(x=>x.job_card_number).filter(k=>!freshKeys.has(k));
  let deleted=0;
  for (let i=0; i<stale.length; i+=100) {
    const ids = stale.slice(i,i+100).map(j=>`"${j}"`).join(",");
    const d = await SB(`draft_jc?job_card_number=in.(${ids})`, {method:"DELETE"});
    if (d.ok||d.status===204) deleted+=Math.min(100,stale.length-i);
  }
  return deleted;
}

export default async function handler() {
  const t0 = Date.now();
  const out = {};

  // JC sync — non-Billed only
  try {
    const res = await fetch(METABASE_JC_URL, {signal:AbortSignal.timeout(25000)});
    if (res.ok) {
      const data = await res.json();
      const nonBilled = data.filter(r=>r["Current JC Status"]!=="Billed");
      const seen = {};
      for (const r of nonBilled) { const k=r["Job Card Number"]; if(k) seen[k]=r; }
      const records = Object.values(seen).map(mapJC).filter(r=>r.job_card_number);
      const {ok,err} = await upsert("draft_jc", records, "job_card_number");
      const deleted = await deleteBilledJCs(new Set(Object.keys(seen)));
      out.jc = {upserted:ok, deleted, errors:err};
    }
  } catch(e) { out.jc = {error:e.message}; }

  // Bike sync
  try {
    const res = await fetch(METABASE_BIKE_URL, {signal:AbortSignal.timeout(25000)});
    if (res.ok) {
      const data = await res.json();
      const seen = {};
      for (const b of data) { if(b["Reg_Number"]) seen[b["Reg_Number"]]=b; }
      const records = Object.values(seen).map(mapBike).filter(r=>r.reg_number);
      const {ok,err} = await upsert("vehicles", records, "reg_number");
      out.bikes = {upserted:ok, errors:err};
    }
  } catch(e) { out.bikes = {error:e.message}; }

  out.elapsed = `${((Date.now()-t0)/1000).toFixed(1)}s`;
  console.log("[sync]", JSON.stringify(out));
  return new Response(JSON.stringify(out), {status:200, headers:{"Content-Type":"application/json"}});
}
