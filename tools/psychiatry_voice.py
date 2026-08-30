#!/usr/bin/env python3
import json,math,re,statistics,subprocess,sys,tempfile,wave
from pathlib import Path
from array import array
def clean(v,n=160):
 s=re.sub(r'\s+',' ',str(v or '')).strip();return s[:n] if s else None
def clamp(v):
 try:return max(0,min(1,float(v)))
 except:return None
def run(args,timeout=30):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError(f'{args[0]} failed: {p.stderr[-600:]}')
 return p.stdout,p.stderr
def load_turns(src):
 if not src:return []
 try:text=Path(src).read_text() if Path(src).is_file() else src
 except:text=src
 try:rows=json.loads(text)
 except:return []
 out=[]
 for r in rows if isinstance(rows,list) else []:
  if not isinstance(r,dict):continue
  try:a=float(r['start']);b=float(r['end'])
  except:continue
  sp=clean(r.get('speaker'),80)
  if not sp or b<=a:continue
  role=str(r.get('role','unknown')).lower();role=role if role in {'patient','clinician','unknown'} else 'unknown'
  try:wc=max(0,int(r.get('word_count',0)))
  except:wc=0
  out.append({'start':a,'end':b,'speaker':sp,'role':role,'role_confidence':clamp(r.get('role_confidence')) or 0,'evidence_ref':clean(r.get('evidence_ref'),160),'word_count':wc})
 return out
def extract(video,start,end,path):
 run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',f'{start:.3f}','-t',f'{end-start:.3f}','-i',video,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',path],30)
def samples(path):
 with wave.open(path,'rb') as w:
  sr=w.getframerate();raw=w.readframes(w.getnframes());x=array('h');x.frombytes(raw)
 return sr,list(x)
def percentile(xs,p):
 if not xs:return None
 y=sorted(xs);i=min(len(y)-1,max(0,round((len(y)-1)*p)));return y[i]
def approx_f0(x,sr):
 if sr>=16000:x=x[::2];sr//=2
 frame=max(160,int(sr*.04));hop=max(80,int(sr*.04));lag0=max(1,int(sr/400));lag1=max(lag0+1,int(sr/70));vals=[];voiced=0;total=0
 if len(x)<frame:return {'assessable':False,'median_hz':None,'p10_hz':None,'p90_hz':None,'range_hz':None,'voiced_frame_fraction':0}
 global_rms=math.sqrt(sum(v*v for v in x)/len(x));threshold=max(80,global_rms*.18)
 for st in range(0,len(x)-frame+1,hop):
  f=x[st:st+frame];m=sum(f)/len(f);f=[v-m for v in f];rms=math.sqrt(sum(v*v for v in f)/len(f));total+=1
  if rms<threshold:continue
  e=sum(v*v for v in f) or 1;best=(0,0)
  for lag in range(lag0,min(lag1,frame-2)+1):
   c=sum(f[i]*f[i+lag] for i in range(frame-lag))/e
   if c>best[1]:best=(lag,c)
  if best[0] and best[1]>=.28:
   hz=sr/best[0]
   if 70<=hz<=400:vals.append(hz);voiced+=1
 if not vals:return {'assessable':False,'median_hz':None,'p10_hz':None,'p90_hz':None,'range_hz':None,'voiced_frame_fraction':round(voiced/max(1,total),3)}
 base=statistics.median(vals);corr=[]
 for hz in vals:
  while hz>base*1.6 and hz/2>=70:hz/=2
  while hz<base/1.6 and hz*2<=400:hz*=2
  corr.append(hz)
 vals=corr;med=statistics.median(vals);lo=percentile(vals,.1);hi=percentile(vals,.9);mad=statistics.median([abs(v-med) for v in vals])
 return {'assessable':True,'method':'autocorrelation_octave_corrected','median_hz':round(med,1),'p10_hz':round(lo,1),'p90_hz':round(hi,1),'range_hz':round(hi-lo,1),'median_abs_deviation_hz':round(mad,1),'voiced_frame_fraction':round(voiced/max(1,total),3)}
def pause_metrics(path,duration):
 _,e=run(['ffmpeg','-hide_banner','-loglevel','info','-i',path,'-af','silencedetect=noise=-35dB:d=0.2','-f','null','-'],30);starts=[float(x) for x in re.findall(r'silence_start: ([0-9.]+)',e)];ends=[float(x) for x in re.findall(r'silence_end: ([0-9.]+)',e)];pairs=list(zip(starts,ends));secs=sum(max(0,b-a) for a,b in pairs);return {'threshold_db':-35,'min_pause_sec':.2,'pause_count':len(pairs),'pause_seconds':round(secs,3),'pause_ratio':round(secs/max(.001,duration),3)}
def volume(path):
 _,e=run(['ffmpeg','-hide_banner','-loglevel','info','-i',path,'-af','volumedetect','-f','null','-'],30)
 def g(k):
  m=re.search(rf'{k}: (-?[0-9.]+) dB',e);return float(m.group(1)) if m else None
 return {'mean_db':g('mean_volume'),'max_db':g('max_volume')}
def segment(video,r):
 d=r['end']-r['start'];tmp=tempfile.mkdtemp(prefix='osa-psych-voice-');wav=str(Path(tmp)/'segment.wav');extract(video,r['start'],r['end'],wav);sr,x=samples(wav);wc=r.get('word_count',0)
 return {'startSec':round(r['start'],3),'endSec':round(r['end'],3),'durationSec':round(d,3),'speaker':r['speaker'],'role_candidate':r['role'] if r['role_confidence']>=.95 and r['evidence_ref'] else 'unknown','role_confidence':r['role_confidence'],'evidence_ref':r['evidence_ref'],'lexical_rate_wpm':round(wc*60/d,1) if wc else None,'word_count':wc,'pause':pause_metrics(wav,d),'volume':volume(wav),'approx_f0':approx_f0(x,sr)}
def analyze(video,turns_src,speaker=None,max_segments=3):
 turns=load_turns(turns_src)
 if speaker:sel=[r for r in turns if r['speaker']==speaker]
 else:
  candidates={r['speaker'] for r in turns if r['role']=='patient' and r['role_confidence']>=.95 and r['evidence_ref']}
  sel=[r for r in turns if len(candidates)==1 and r['speaker'] in candidates]
 sel=[r for r in sel if .5<=r['end']-r['start']<=30][:max(1,min(3,int(max_segments)))]
 seg=[]
 for r in sel:
  try:seg.append(segment(video,r))
  except Exception as e:seg.append({'startSec':r['start'],'endSec':r['end'],'speaker':r['speaker'],'status':'not_assessable','error':clean(e)})
 return {'ok':True,'subject':f"speaker_candidate:{speaker or (sel[0]['speaker'] if sel else 'unknown')}",'segments':seg,'safeguards':{'voice_identity_claim':False,'diagnosis_from_voice':False,'f0_is_approximate_signal_measurement':True,'role_requires_independent_turn_evidence':True}}
def self_test():
 sr=8000;hz=200;tmp=tempfile.mkdtemp();p=str(Path(tmp)/'s.wav');x=array('h',(int(10000*math.sin(2*math.pi*hz*i/sr)) for i in range(sr*2)))
 with wave.open(p,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes(x.tobytes())
 f=approx_f0(list(x),sr);assert f['assessable'] and 180<=f['median_hz']<=220
 assert load_turns('[{"start":1,"end":2,"speaker":"S1","role":"patient","role_confidence":0.99,"evidence_ref":"x","word_count":4}]')[0]['word_count']==4
 print(json.dumps({'ok':True,'self_test':'passed','test_f0_hz':f['median_hz']}))
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--self-test':self_test();raise SystemExit
 if len(sys.argv)<3:raise SystemExit('usage: psychiatry_voice.py <video> <turns-json-or-path> [speaker] [max_segments]')
 print(json.dumps(analyze(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 and sys.argv[3]!='-' else None,int(sys.argv[4]) if len(sys.argv)>4 else 3),ensure_ascii=False,indent=2))
