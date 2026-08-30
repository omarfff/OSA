#!/usr/bin/env python3
import base64, json, os, re, subprocess, sys, tempfile
from pathlib import Path
from urllib.request import Request, urlopen
OLLAMA="http://127.0.0.1:11434"
ALLOWED={"appearance","posture","gaze","facial_expression","gestures","psychomotor_activity","interpersonal_behavior","cooperation","distractibility","repetitive_movements","gait","visible_self_care"}
MODEL_PATTERNS=(r"moondream",r"llava",r"qwen.*vl",r"minicpm.*v",r"gemma3",r"qwen3\.5")
def run(args,timeout=30):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode: raise RuntimeError(f"{args[0]} failed: {p.stderr[-800:]}")
 return p.stdout,p.stderr
def clean(v,n=180):
 if v is None:return None
 s=re.sub(r"\s+"," ",str(v)).strip();return s[:n] if s else None
def normalize(raw):
 obs=raw.get("observations",raw) if isinstance(raw,dict) else {};out={}
 for k,v in obs.items():
  if k not in ALLOWED: continue
  if isinstance(v,list): out[k]=[clean(x,120) for x in v if clean(x,120)][:8]
  else:
   x=clean(v)
   if x: out[k]=x
 try:c=max(0,min(1,float(raw.get("confidence"))))
 except:c=None
 lim=raw.get("limitations",[]) if isinstance(raw,dict) else []
 return {"status":"observed" if out else "not_assessable","observations":out,"confidence":c,"limitations":[clean(x,140) for x in lim if clean(x,140)][:8]}
def motion(text):
 vals=[float(x) for x in re.findall(r"lavfi\.scene_score=([0-9]*\.?[0-9]+)",text)]
 if not vals:return {"assessable":False,"mean_scene_change":None,"peak_scene_change":None,"samples":0}
 vals=[max(0,min(1,x)) for x in vals]
 return {"assessable":True,"mean_scene_change":round(sum(vals)/len(vals),4),"peak_scene_change":round(max(vals),4),"samples":len(vals)}
def http_json(path,payload=None,timeout=45):
 data=None if payload is None else json.dumps(payload).encode();req=Request(OLLAMA+path,data=data,headers={"content-type":"application/json"} if data else {})
 with urlopen(req,timeout=timeout) as r:return json.load(r)
def detect_model():
 preferred=os.getenv("OSA_PSYCH_VISION_MODEL","").strip()
 if preferred:return preferred
 try:names=[str(x.get("name","")) for x in http_json("/api/tags").get("models",[])]
 except:return None
 return next((n for n in names if any(re.search(p,n,re.I) for p in MODEL_PATTERNS)),None)
def prompt(start,m):
 me=f"mean={m['mean_scene_change']}, peak={m['peak_scene_change']}" if m["assessable"] else "unavailable"
 return ("You are a psychiatric VIDEO OBSERVATION assistant, not a diagnostic system. " f"These sequential frames cover about 2 seconds near {start:.2f}s. Frame-change evidence is {me}; use it only as movement evidence, not meaning. " "Describe ONLY directly visible behavior across the frames. Allowed JSON observation keys: appearance, posture, gaze, facial_expression, gestures, psychomotor_activity, interpersonal_behavior, cooperation, distractibility, repetitive_movements, gait, visible_self_care. " "Do not diagnose mania, depression, psychosis, catatonia, intoxication, personality disorder, anxiety, or any condition. Do not infer internal mood, intent, or sensitive traits. If ambiguous, say so in limitations. " 'Return JSON only: {"observations":{},"confidence":0.0,"limitations":[]}')
def analyze_images(files,start,m,model):
 if not model:return {"status":"not_assessable","observations":{},"confidence":None,"limitations":["No local vision-capable Ollama model is configured."],"model":None}
 try:
  imgs=[base64.b64encode(Path(f).read_bytes()).decode() for f in files]
  data=http_json("/api/chat",{"model":model,"stream":False,"format":"json","options":{"temperature":0},"messages":[{"role":"user","content":prompt(start,m),"images":imgs}]})
  raw=json.loads(str(data.get("message",{}).get("content",data.get("response",""))));out=normalize(raw);out["model"]=model;return out
 except Exception as e:return {"status":"not_assessable","observations":{},"confidence":None,"limitations":[f"Vision inference unavailable: {clean(e)}"],"model":model}
def duration(video):
 o,_=run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",video]);x=float(o.strip())
 if x<=0:raise RuntimeError("video duration unavailable")
 return x
def frames(video,start,folder):
 files=[]
 for i,off in enumerate((0,0.8,1.6),1):
  f=str(Path(folder)/f"frame-{i:02}.jpg");run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",f"{start+off:.3f}","-i",video,"-frames:v","1","-vf","scale=640:-2","-q:v","4",f],20);files.append(f)
 return files
def motion_window(video,start):
 try:
  o,e=run(["ffmpeg","-hide_banner","-loglevel","info","-ss",f"{start:.3f}","-t","2.4","-i",video,"-vf","fps=4,select='gte(scene,0)',metadata=print","-an","-f","null","-"],20);return motion(o+"\n"+e)
 except:return motion("")
def analyze(video,interval=10,max_windows=6,out=None):
 d=duration(video);interval=max(3,float(interval));max_windows=max(1,min(12,int(max_windows)));root=Path(out or tempfile.mkdtemp(prefix="osa-psych-vision-"));root.mkdir(parents=True,exist_ok=True);model=detect_model();windows=[];t=0.0
 while t<max(.1,d-.2) and len(windows)<max_windows:
  wd=root/f"window-{len(windows)+1:02}";wd.mkdir(exist_ok=True);fs=frames(video,t,wd);m=motion_window(video,t);v=analyze_images(fs,t,m,model);windows.append({"startSec":round(t,3),"framePaths":fs,"motion":m,"visual":v});t+=interval
 return {"ok":True,"video":video,"durationSec":round(d,3),"visionModel":model,"windows":windows,"safeguards":{"observation_before_interpretation":True,"diagnosis_from_visual_behavior":False,"missing_or_ambiguous_visual_data":"not_assessable","max_windows":12}}
def self_test():
 assert motion("lavfi.scene_score=0.1\nlavfi.scene_score=0.3")["mean_scene_change"]==0.2
 n=normalize({"observations":{"posture":"upright","diagnosis":"mania"},"confidence":1.7});assert n["observations"]=={"posture":"upright"} and n["confidence"]==1
 assert "Do not diagnose" in prompt(1,motion(""));print(json.dumps({"ok":True,"self_test":"passed"}))
if __name__=="__main__":
 if len(sys.argv)>1 and sys.argv[1]=="--self-test":self_test();raise SystemExit
 if len(sys.argv)<2:raise SystemExit("usage: psychiatry_vision.py <video> [interval] [max_windows]")
 print(json.dumps(analyze(sys.argv[1],float(sys.argv[2]) if len(sys.argv)>2 else 10,int(sys.argv[3]) if len(sys.argv)>3 else 6),ensure_ascii=False,indent=2))
