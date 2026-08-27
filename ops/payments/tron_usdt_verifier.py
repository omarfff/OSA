#!/usr/bin/env python3
import argparse, hashlib, json, os, re, sqlite3, time
import urllib.request, urllib.error, urllib.parse
from decimal import Decimal, InvalidOperation
from pathlib import Path

BASE=os.getenv("OSA_TRONGRID_BASE","https://api.trongrid.io").rstrip("/")
USDT="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
SCALE=1_000_000
WALLET_FILE=Path("/opt/osa/secure/wallets/osa-tron-mainnet.address")
DB=Path("/var/lib/osa/tron-usdt-receipts.sqlite3")
STATE=Path("/var/lib/osa/tron-usdt-watch-state.json")
KEYFILE=Path("/etc/osa/trongrid-api-key")
TXRE=re.compile(r"^[0-9a-fA-F]{64}$")
B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

class VError(RuntimeError): pass

def wallet():
    w=os.getenv("OSA_TRON_WALLET","").strip() or (WALLET_FILE.read_text().strip() if WALLET_FILE.exists() else "")
    if len(w)!=34 or not w.startswith("T"): raise VError("invalid_or_missing_tron_wallet")
    return w

def api_key():
    k=os.getenv("TRON_PRO_API_KEY","").strip()
    if k:return k
    try:return KEYFILE.read_text().strip() or None
    except FileNotFoundError:return None

def req(url,payload=None,tries=3,timeout=10):
    h={"Accept":"application/json","Content-Type":"application/json","User-Agent":"OSA-TronUSDT/2.0"}
    if api_key():h["TRON-PRO-API-KEY"]=api_key()
    data=None if payload is None else json.dumps(payload).encode()
    last=None
    for i in range(tries):
        try:
            r=urllib.request.Request(url,data=data,headers=h,method="GET" if payload is None else "POST")
            with urllib.request.urlopen(r,timeout=timeout) as x:
                o=json.loads(x.read().decode())
                if not isinstance(o,dict):raise VError("invalid_json")
                return o
        except urllib.error.HTTPError as e:
            last=e
            if e.code not in (408,425,429,500,502,503,504):raise VError(f"http_{e.code}")
            if i+1<tries:
                delay=6.0 if e.code==429 else .6*(2**i)
                try:
                    if e.headers.get("Retry-After"): delay=max(delay,float(e.headers.get("Retry-After")))
                except Exception: pass
                time.sleep(delay)
                continue
        except Exception as e:last=e
        if i+1<tries:time.sleep(.6*(2**i))
    raise VError(f"network_failure:{type(last).__name__}")

def b58(raw):
    n=int.from_bytes(raw,"big"); out=""
    while n:n,r=divmod(n,58);out=B58[r]+out
    pad=len(raw)-len(raw.lstrip(b"\0"))
    return "1"*pad+out

def norm(a):
    s=str(a or "").strip()
    if len(s)==34 and s.startswith("T"):return s
    v=s.lower().removeprefix("0x")
    if re.fullmatch(r"[0-9a-f]{40}",v):v="41"+v
    if re.fullmatch(r"41[0-9a-f]{40}",v):
        body=bytes.fromhex(v); c=hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4]
        return b58(body+c)
    return s

def rawint(v):
    s=str(v).strip()
    return int(s,16) if s.lower().startswith("0x") else int(s)

def amount_raw(v):
    try:d=Decimal(str(v))
    except (InvalidOperation,ValueError):raise VError("invalid_expected_amount")
    if not d.is_finite() or d<=0:raise VError("expected_amount_must_be_positive")
    x=d*SCALE
    if x!=x.to_integral_value():raise VError("usdt_supports_max_6_decimals")
    return int(x)

def amt(raw):
    q,r=divmod(int(raw),SCALE);return f"{q}.{r:06d}"

def db():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB);c.row_factory=sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL");c.execute("PRAGMA synchronous=FULL")
    c.execute("""CREATE TABLE IF NOT EXISTS receipts(
      tx_id TEXT PRIMARY KEY,wallet TEXT NOT NULL,contract TEXT NOT NULL,
      amount_raw INTEGER NOT NULL,amount_usdt TEXT NOT NULL,sender TEXT,
      block_timestamp INTEGER,status TEXT NOT NULL,source TEXT NOT NULL,
      expected_raw INTEGER,first_seen_at INTEGER NOT NULL,verified_at INTEGER)""")
    c.commit();return c

def save(c,tx,w,raw,sender,ts,status,source,expected=None):
    now=int(time.time())
    c.execute("""INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tx_id) DO UPDATE SET
      wallet=excluded.wallet,contract=excluded.contract,amount_raw=excluded.amount_raw,
      amount_usdt=excluded.amount_usdt,sender=COALESCE(excluded.sender,receipts.sender),
      block_timestamp=COALESCE(excluded.block_timestamp,receipts.block_timestamp),
      status=CASE WHEN receipts.status='verified' THEN 'verified' ELSE excluded.status END,
      source=excluded.source,expected_raw=COALESCE(excluded.expected_raw,receipts.expected_raw),
      verified_at=CASE WHEN excluded.status='verified' THEN excluded.verified_at ELSE receipts.verified_at END""",
      (tx,w,USDT,raw,amt(raw),sender,ts,status,source,expected,now,now if status=="verified" else None))
    c.commit()

def verify(tx,expected,w=None):
    tx=tx.strip().lower().removeprefix("0x")
    if not TXRE.fullmatch(tx):return {"ok":False,"verified":False,"reason":"invalid_tx_id"}
    w=w or wallet(); exp=amount_raw(expected); c=db()
    old=c.execute("SELECT * FROM receipts WHERE tx_id=?",(tx,)).fetchone()
    if old and old["status"]=="verified":
        same=old["wallet"]==w and int(old["amount_raw"])==exp and old["contract"]==USDT
        return {"ok":same,"verified":same,"reason":"already_verified" if same else "tx_id_already_used","tx_id":tx,"idempotent":True}
    receipt=req(f"{BASE}/walletsolidity/gettransactioninfobyid",{"value":tx})
    if not receipt or not receipt.get("id"):return {"ok":False,"verified":False,"reason":"not_solidified_or_not_found","tx_id":tx}
    if str((receipt.get("receipt") or {}).get("result","")).upper()!="SUCCESS":
        return {"ok":False,"verified":False,"reason":"transaction_execution_not_success","tx_id":tx}
    events=req(f"{BASE}/v1/transactions/{tx}/events?only_confirmed=true").get("data") or []
    seen_wallet=False
    for e in events:
        if e.get("event_name")!="Transfer" or norm(e.get("contract_address"))!=USDT:continue
        r=e.get("result") or {}
        if norm(r.get("to"))!=w:continue
        seen_wallet=True
        try:raw=rawint(r.get("value"))
        except:continue
        sender=norm(r.get("from"))
        try:ts=int(e.get("block_timestamp") or 0) or None
        except:ts=None
        if raw!=exp:
            save(c,tx,w,raw,sender,ts,"observed","verify",exp)
            return {"ok":False,"verified":False,"reason":"amount_mismatch","tx_id":tx,"expected_usdt":amt(exp),"actual_usdt":amt(raw)}
        save(c,tx,w,raw,sender,ts,"verified","verify",exp)
        return {"ok":True,"verified":True,"reason":"verified","tx_id":tx,"wallet":w,"network":"TRON","token":"USDT","contract":USDT,"amount_usdt":amt(raw),"amount_raw":raw,"sender":sender,"solidified":True,"idempotent":False}
    return {"ok":False,"verified":False,"reason":"recipient_mismatch" if seen_wallet else "official_usdt_transfer_event_not_found","tx_id":tx}

def scan(w=None,limit=50):
    w=w or wallet();limit=max(1,min(int(limit),200))
    qs=urllib.parse.urlencode({"only_confirmed":"true","only_to":"true","limit":limit,"order_by":"block_timestamp,desc","contract_address":USDT})
    rows=req(f"{BASE}/v1/accounts/{w}/transactions/trc20?{qs}").get("data") or []
    c=db();new=obs=0;latest=0
    for r in rows:
        tx=str(r.get("transaction_id") or "").lower()
        token=r.get("token_info") or {}
        if not TXRE.fullmatch(tx) or norm(token.get("address") or r.get("contract_address"))!=USDT or norm(r.get("to"))!=w:continue
        try:raw=rawint(r.get("value"))
        except:continue
        existed=c.execute("SELECT 1 FROM receipts WHERE tx_id=?",(tx,)).fetchone() is not None
        try:ts=int(r.get("block_timestamp") or 0) or None
        except:ts=None
        if ts:latest=max(latest,ts)
        save(c,tx,w,raw,norm(r.get("from")),ts,"observed","watcher")
        obs+=1;new+=0 if existed else 1
    out={"ok":True,"wallet":w,"network":"TRON","token":"USDT","contract":USDT,"checked_at":int(time.time()),"observed_in_page":obs,"new_receipts":new,"latest_block_timestamp":latest or None}
    tmp=STATE.with_suffix(".tmp");tmp.write_text(json.dumps(out,indent=2)+"\n");os.chmod(tmp,0o644);os.replace(tmp,STATE)
    return out

def health():
    w=wallet();t=time.monotonic()
    o=req(f"{BASE}/v1/accounts/{w}?only_confirmed=true",tries=2)
    return {"ok":isinstance(o.get("data",[]),list),"wallet":w,"latency_ms":int((time.monotonic()-t)*1000),"api_key_configured":bool(api_key()),"db":str(DB)}

def recent(n=20):
    c=db();rows=c.execute("SELECT tx_id,wallet,amount_usdt,sender,block_timestamp,status,source,expected_raw,first_seen_at,verified_at FROM receipts ORDER BY COALESCE(block_timestamp,first_seen_at*1000) DESC LIMIT ?",(max(1,min(int(n),100)),)).fetchall()
    return {"ok":True,"receipts":[dict(x) for x in rows]}

def main():
    p=argparse.ArgumentParser(prog="osa-tron-usdt");s=p.add_subparsers(dest="cmd",required=True)
    v=s.add_parser("verify");v.add_argument("tx_id");v.add_argument("expected_amount");v.add_argument("--wallet")
    q=s.add_parser("scan");q.add_argument("--wallet");q.add_argument("--limit",type=int,default=50)
    s.add_parser("health");r=s.add_parser("recent");r.add_argument("--limit",type=int,default=20)
    a=p.parse_args()
    try:
        out=verify(a.tx_id,a.expected_amount,a.wallet) if a.cmd=="verify" else scan(a.wallet,a.limit) if a.cmd=="scan" else health() if a.cmd=="health" else recent(a.limit)
        print(json.dumps(out,ensure_ascii=False,indent=2))
        return 0 if (a.cmd!="verify" or out.get("verified")) else 2
    except VError as e:print(json.dumps({"ok":False,"error":str(e)}));return 3
    except Exception as e:print(json.dumps({"ok":False,"error":f"{type(e).__name__}:{str(e)[:160]}"}));return 4
if __name__=="__main__":raise SystemExit(main())
