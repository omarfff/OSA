#!/usr/bin/env python3
import json,os,sys,tempfile
from pathlib import Path
import psychiatry_vision as pv
import psychiatry_av_align as av
def fuse(behavior,align):
 v=behavior.get('visual',{});a=align.get('attribution',{});out={'status':'unattributed','subject':'visible_person_unattributed','role_candidate':'unknown','observations':v.get('observations',{}),'behavior_confidence':v.get('confidence'),'attribution_confidence':0,'combined_confidence':0,'reasons':[]}
 bs=behavior.get('startSec');as_=align.get('startSec')
 if bs is None or as_ is None or abs(float(bs)-float(as_))>.01:out['reasons'].append('window_timestamp_mismatch');return out
 if v.get('status')!='observed' or not out['observations']:out['reasons'].append('behavior_not_observed');return out
 if a.get('status')!='speaker_candidate':out['reasons'].append('speaker_not_aligned');return out
 bc=v.get('confidence');ac=a.get('confidence',0)
 if bc is None or bc<.7:out['reasons'].append('behavior_confidence_below_threshold');return out
 out.update({'status':'candidate_observation','subject':a.get('subject','visible_person_unattributed'),'role_candidate':a.get('role_candidate','unknown'),'attribution_confidence':ac,'combined_confidence':round(min(bc,ac),3)})
 return out
def summarize(fused):
 good=[x for x in fused if x.get('status')=='candidate_observation' and x.get('combined_confidence',0)>=.75]
 by={}
 for x in good:by.setdefault((x.get('subject'),x.get('role_candidate')),[]).append(x)
 best=max(by.values(),key=len) if by else []
 repeated=len(best)>=2
 role=best[0].get('role_candidate') if best else 'unknown';subject=best[0].get('subject') if best else 'visible_person_unattributed'
 return {'repeated_candidate_windows':len(best),'subject_candidate':subject,'role_candidate':role,'eligible_for_brain_observation_learning':bool(repeated and role=='patient'),'evidence_level':'repeated_candidate' if repeated else 'insufficient_alignment','diagnostic_use':False,'identity_claim':False}
def analyze(video,turns,start=0,interval=2,max_windows=2):
 n=max(1,min(4,int(max_windows)));step=max(3,float(interval));old=os.environ.get('OSA_PSYCH_VISION_START_SEC');os.environ['OSA_PSYCH_VISION_START_SEC']=str(float(start))
 try:b=pv.analyze(video,step,n,out=tempfile.mkdtemp(prefix='osa-psych-mm-beh-'))
 finally:
  if old is None:os.environ.pop('OSA_PSYCH_VISION_START_SEC',None)
  else:os.environ['OSA_PSYCH_VISION_START_SEC']=old
 a=av.analyze(video,turns,start,step,n);f=[]
 for bw,aw in zip(b.get('windows',[]),a.get('windows',[])):
  x=fuse(bw,aw);x['startSec']=bw.get('startSec');f.append(x)
 return {'ok':True,'behaviorVisionModel':b.get('visionModel'),'alignmentVisionModel':a.get('visionModel'),'windows':f,'series':summarize(f),'safeguards':{'observations_before_interpretation':True,'candidate_not_identity':True,'requires_repeated_alignment_for_brain_learning':True,'window_timestamp_alignment_required':True,'diagnosis_from_multimodal':False}}
def self_test():
 b={'startSec':1.0,'visual':{'status':'observed','observations':{'posture':'leaning forward'},'confidence':.9}};neg={'startSec':1.0,'attribution':{'status':'unattributed','confidence':0}};assert fuse(b,neg)['status']=='unattributed'
 pos={'startSec':1.0,'attribution':{'status':'speaker_candidate','subject':'speaker_candidate:S1','role_candidate':'patient','confidence':.95}};x=fuse(b,pos);assert x['status']=='candidate_observation' and x['role_candidate']=='patient'
 s=summarize([x,x]);assert s['eligible_for_brain_observation_learning'] is True and s['diagnostic_use'] is False and s['identity_claim'] is False
 print(json.dumps({'ok':True,'self_test':'passed'}))
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--self-test':self_test();raise SystemExit
 if len(sys.argv)<3:raise SystemExit('usage: psychiatry_multimodal.py <video> <turns-json-or-path> [start] [interval] [max_windows]')
 print(json.dumps(analyze(sys.argv[1],sys.argv[2],float(sys.argv[3]) if len(sys.argv)>3 else 0,float(sys.argv[4]) if len(sys.argv)>4 else 2,int(sys.argv[5]) if len(sys.argv)>5 else 2),ensure_ascii=False,indent=2))
