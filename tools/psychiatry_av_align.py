#!/usr/bin/env python3
import base64,json,os,re,subprocess,sys,tempfile
from pathlib import Path
from urllib.request import Request,urlopen
OLLAMA='http://127.0.0.1:11434'
MODELS=(r'moondream',r'llava',r'qwen.*vl',r'minicpm.*v',r'gemma3',r'qwen3\.5')
ROLES={'patient','clinician','unknown'}
def clean(v,n=160):
 s=re.sub(r'\s+',' ',str(v or '')).strip();return s[:n] if s else None
def clamp(v):
 try:return max(0,min(1,float(v)))
 except:return None
def run(args,timeout=25):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError(f'{args[0]} failed: {p.stderr[-500:]}')
 return p.stdout,p.stderr
def http_json(path,payload=None,timeout=45):
 data=None if payload is None else json.dumps(payload).encode();req=Request(OLLAMA+path,data=data,headers={'content-type':'application/json'} if data else {})
 with urlopen(req,timeout=timeout) as r:return json.load(r)
def detect_model():
 p=os.getenv('OSA_PSYCH_VISION_MODEL','').strip()
 if p:return p
 try:n=[str(x.get('name','')) for x in http_json('/api/tags').get('models',[])]
 except:return None
 return next((x for x in n if any(re.search(p,x,re.I) for p in MODELS)),None)
def frames(video,start,folder):
 out=[]
 for i,off in enumerate((0,.25,.50,.75),1):
  f=str(Path(folder)/f'a-{i:02}.jpg');run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',f'{start+off:.3f}','-i',video,'-frames:v','1','-vf','scale=256:-2','-q:v','5',f],20);out.append(f)
 return out
def prompt(start):
 return (f'Four sequential video frames span about 0.75 seconds near {start:.2f}s. Assess only visible active-speaker evidence. '
 'Never infer identity, role, gender, emotion, diagnosis, or intent. Do not call anyone patient or clinician. '
 'visible_people_count is number clearly visible (0-3). mouth_visibility must be clear, partial, or not_visible. '
 'mouth_activity must be speaking_like only when visible mouth configuration changes across frames in a way consistent with speech; otherwise not_speaking_like or unclear. '
 'camera_cut_likely is true if framing/person changes make comparison unreliable. confidence is visual clarity only. Return JSON only.')
def normalize(raw):
 if not isinstance(raw,dict):raw={}
 try:c=max(0,min(3,int(raw.get('visible_people_count',0))))
 except:c=0
 mv=str(raw.get('mouth_visibility','not_visible')).lower();mv=mv if mv in {'clear','partial','not_visible'} else 'not_visible'
 ma=str(raw.get('mouth_activity','unclear')).lower();ma=ma if ma in {'speaking_like','not_speaking_like','unclear'} else 'unclear'
 cut=raw.get('camera_cut_likely',True);cut=cut if isinstance(cut,bool) else True
 lim=raw.get('limitations',[]);lim=[lim] if isinstance(lim,str) else lim if isinstance(lim,list) else []
 echo=('visible_people_count','mouth_visibility must','mouth_activity must','no one is patient or clinician','number clearly visible')
 lc=[clean(x,120) for x in lim if clean(x,120)]
 lc=[x for x in lc if not any(e in x.lower() for e in echo)][:4]
 return {'visible_people_count':c,'mouth_visibility':mv,'mouth_activity':ma,'camera_cut_likely':cut,'confidence':clamp(raw.get('confidence')),'limitations':lc}
def vision(files,start,model):
 if not model:return {'visible_people_count':0,'mouth_visibility':'not_visible','mouth_activity':'unclear','camera_cut_likely':True,'confidence':None,'limitations':['No local vision model']}
 schema={'type':'object','properties':{'visible_people_count':{'type':'integer','minimum':0,'maximum':3},'mouth_visibility':{'type':'string','enum':['clear','partial','not_visible']},'mouth_activity':{'type':'string','enum':['speaking_like','not_speaking_like','unclear']},'camera_cut_likely':{'type':'boolean'},'confidence':{'type':'number','minimum':0,'maximum':1},'limitations':{'type':'array','items':{'type':'string'},'maxItems':3}},'required':['visible_people_count','mouth_visibility','mouth_activity','camera_cut_likely','confidence','limitations'],'additionalProperties':False}
 try:
  imgs=[base64.b64encode(Path(f).read_bytes()).decode() for f in files]
  d=http_json('/api/chat',{'model':model,'stream':False,'think':False,'format':schema,'keep_alive':'20s','options':{'temperature':0,'num_ctx':1536,'num_predict':140},'messages':[{'role':'user','content':prompt(start),'images':imgs}]},55)
  return normalize(json.loads(str(d.get('message',{}).get('content',d.get('response','')))))
 except Exception as e:return {'visible_people_count':0,'mouth_visibility':'not_visible','mouth_activity':'unclear','camera_cut_likely':True,'confidence':None,'limitations':[f'Vision unavailable: {clean(e)}']}
def load_turns(src):
 if not src:return []
 try:text=Path(src).read_text() if Path(src).is_file() else src
 except:text=src
 try:rows=json.loads(text)
 except:return []
 out=[]
 if not isinstance(rows,list):return out
 for r in rows:
  if not isinstance(r,dict):continue
  try:a=float(r['start']);b=float(r['end'])
  except:continue
  sp=clean(r.get('speaker'),80);role=str(r.get('role','unknown')).lower();role=role if role in ROLES else 'unknown'
  if not sp or b<=a:continue
  out.append({'start':a,'end':b,'speaker':sp,'role':role,'role_confidence':clamp(r.get('role_confidence')) or 0,'evidence_ref':clean(r.get('evidence_ref'),160)})
 return out
def speaker_context(turns,start,span=.75):
 end=start+span;by={}
 for r in turns:
  ov=max(0,min(end,r['end'])-max(start,r['start']))
  if ov<=0:continue
  x=by.setdefault(r['speaker'],{'overlap':0,'rows':[]});x['overlap']+=ov;x['rows'].append((ov,r))
 if len(by)!=1:return {'status':'ambiguous' if by else 'none','coverage':0,'speaker':None,'role':'unknown','role_confidence':0,'evidence_ref':None}
 sp,x=next(iter(by.items()));coverage=min(1,x['overlap']/span);r=max(x['rows'],key=lambda z:z[0])[1]
 return {'status':'single_speaker' if coverage>=.8 else 'partial','coverage':round(coverage,3),'speaker':sp,'role':r['role'],'role_confidence':r['role_confidence'],'evidence_ref':r['evidence_ref']}
def attribute(v,s):
 res={'status':'unattributed','subject':'visible_person_unattributed','role_candidate':'unknown','confidence':0,'reasons':[]}
 if s.get('status')!='single_speaker':res['reasons'].append('audio_not_single_speaker');return res
 if v.get('visible_people_count')!=1:res['reasons'].append('visual_people_count_not_one');return res
 if v.get('mouth_visibility')!='clear':res['reasons'].append('mouth_not_clearly_visible');return res
 if v.get('mouth_activity')!='speaking_like':res['reasons'].append('visible_mouth_not_speaking_like');return res
 if v.get('camera_cut_likely'):res['reasons'].append('camera_cut_or_unstable_framing');return res
 vc=v.get('confidence')
 if vc is None or vc<.75:res['reasons'].append('visual_confidence_below_threshold');return res
 res.update({'status':'speaker_candidate','subject':f"speaker_candidate:{s['speaker']}",'confidence':round(min(vc,s.get('coverage',0)),3)})
 if s.get('role') in {'patient','clinician'} and s.get('role_confidence',0)>=.95 and s.get('evidence_ref'):res['role_candidate']=s['role']
 return res
def analyze(video,turns_src,start=0,interval=2,max_windows=1):
 turns=load_turns(turns_src);model=detect_model();root=Path(tempfile.mkdtemp(prefix='osa-psych-av-'));wins=[]
 for i in range(max(1,min(6,int(max_windows)))):
  t=float(start)+i*max(.8,float(interval));d=root/f'w{i+1:02}';d.mkdir();fs=frames(video,t,d);v=vision(fs,t,model);s=speaker_context(turns,t);wins.append({'startSec':round(t,3),'visualSpeakerEvidence':v,'audioSpeakerContext':s,'attribution':attribute(v,s)})
 return {'ok':True,'visionModel':model,'windows':wins,'safeguards':{'attribution_is_candidate_not_identity':True,'role_requires_independent_audio_evidence':True,'diagnosis_from_alignment':False,'ambiguous_alignment':'unattributed'}}
def self_test():
 assert normalize({'visible_people_count':8,'mouth_visibility':'x','mouth_activity':'x','camera_cut_likely':'no'})['camera_cut_likely'] is True
 turns=[{'start':1,'end':3,'speaker':'S1','role':'patient','role_confidence':.99,'evidence_ref':'test'}];s=speaker_context(turns,1.2);assert s['status']=='single_speaker' and s['speaker']=='S1'
 bad={'visible_people_count':1,'mouth_visibility':'clear','mouth_activity':'not_speaking_like','camera_cut_likely':False,'confidence':.9};assert attribute(bad,s)['status']=='unattributed'
 good={**bad,'mouth_activity':'speaking_like'};a=attribute(good,s);assert a['status']=='speaker_candidate' and a['role_candidate']=='patient' and a['subject'].startswith('speaker_candidate:')
 print(json.dumps({'ok':True,'self_test':'passed'}))
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--self-test':self_test();raise SystemExit
 if len(sys.argv)<3:raise SystemExit('usage: psychiatry_av_align.py <video> <turns-json-or-path> [start] [interval] [max_windows]')
 print(json.dumps(analyze(sys.argv[1],sys.argv[2],float(sys.argv[3]) if len(sys.argv)>3 else 0,float(sys.argv[4]) if len(sys.argv)>4 else 2,int(sys.argv[5]) if len(sys.argv)>5 else 1),ensure_ascii=False,indent=2))
