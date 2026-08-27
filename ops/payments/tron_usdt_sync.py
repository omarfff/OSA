#!/usr/bin/env python3
import base64, hashlib, json, sqlite3, subprocess, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

DB=Path("/var/lib/osa/tron-usdt-receipts.sqlite3")
PRIV=Path("/opt/osa/secrets/tron-ingest/private.pem")
URL="https://jpnlmpqqtiwisxcsjwbm.supabase.co/functions/v1/osa-tron-usdt-ingest"

def iso_ms(v):
    if v is None: return None
    try:
        n=int(v)
        if n <= 0: return None
        return datetime.fromtimestamp(n/1000, timezone.utc).isoformat()
    except Exception:
        return None

def sign(ts, body):
    p=subprocess.run(
        ["openssl","dgst","-sha256","-sign",str(PRIV)],
        input=(ts+"\n"+body).encode(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True
    )
    return base64.b64encode(p.stdout).decode()

def post(obj):
    body=json.dumps(obj,separators=(",",":"),sort_keys=True)
    ts=str(int(time.time()*1000))
    sig=sign(ts,body)
    req=urllib.request.Request(URL,data=body.encode(),method="POST",headers={
        "Content-Type":"application/json",
        "Accept":"application/json",
        "User-Agent":"OSA-TronUSDT-Sync/1.0",
        "X-OSA-Timestamp":ts,
        "X-OSA-Signature":sig,
    })
    with urllib.request.urlopen(req,timeout=12) as r:
        data=json.loads(r.read().decode())
        if not data.get("ok") or not data.get("accepted"):
            raise RuntimeError("ingest_rejected")
        return data

def main():
    if not DB.exists(): raise SystemExit("receipt_db_missing")
    if not PRIV.exists(): raise SystemExit("signing_key_missing")
    c=sqlite3.connect(DB)
    c.row_factory=sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS sync_state(
      tx_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    )""")
    rows=c.execute("""SELECT tx_id,wallet,contract,amount_raw,sender,block_timestamp,
                            status,source,verified_at
                     FROM receipts
                     ORDER BY COALESCE(block_timestamp,first_seen_at*1000) ASC
                     LIMIT 500""").fetchall()
    sent=skipped=failed=0
    errors=[]
    for r in rows:
        obj={
            "txid":r["tx_id"],
            "event_index":0,
            "from_address":r["sender"],
            "to_address":r["wallet"],
            "amount_micro":int(r["amount_raw"]),
            "contract_address":r["contract"],
            "block_number":None,
            "block_timestamp":iso_ms(r["block_timestamp"]),
            "confirmed":True,
            "raw_event":{
                "local_status":r["status"],
                "local_source":r["source"],
                "verified_at":r["verified_at"],
            },
        }
        body=json.dumps(obj,separators=(",",":"),sort_keys=True)
        fp=hashlib.sha256(body.encode()).hexdigest()
        old=c.execute("SELECT fingerprint FROM sync_state WHERE tx_id=?",(r["tx_id"],)).fetchone()
        if old and old["fingerprint"]==fp:
            skipped+=1
            continue
        try:
            post(obj)
            c.execute("""INSERT INTO sync_state(tx_id,fingerprint,synced_at) VALUES(?,?,?)
                         ON CONFLICT(tx_id) DO UPDATE SET
                         fingerprint=excluded.fingerprint,synced_at=excluded.synced_at""",
                      (r["tx_id"],fp,int(time.time())))
            c.commit()
            sent+=1
        except Exception as e:
            failed+=1
            errors.append({"tx_id":r["tx_id"],"error":type(e).__name__+":"+str(e)[:120]})
    print(json.dumps({"ok":failed==0,"rows":len(rows),"sent":sent,"skipped":skipped,"failed":failed,"errors":errors[:10]}))
    return 0 if failed==0 else 2

if __name__=="__main__":
    raise SystemExit(main())
