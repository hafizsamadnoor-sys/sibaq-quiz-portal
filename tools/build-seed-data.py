#!/usr/bin/env python3
"""
Build seed-data.json from Samad's own question sheets (no invented questions).
Sources:
  GK  : ~/workspace/user/files/SIBAQ26_BNS30_GK_Quiz_Sheet.pdf  (pdftotext -raw)
  IH  : ~/workspace/your_files/islamic-history-200-questions/islamic-history-200-questions.pdf (pdftotext -raw)
Run:  python3 tools/build-seed-data.py   (requires pdftotext / poppler)
Output: ../seed-data.json with deterministic MCQ options (seeded RNG).
Skip rules: answer >90 chars, or multi-name list answer (>=2 commas + 'and').
Validation: IH 1=570 CE, 2=Makkah, 10=Cave Hira, 22 contains '2 AH'.
"""
import re, json, subprocess, pathlib, random, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOME = pathlib.Path.home()
GK_PDF = HOME/"workspace/user/files/SIBAQ26_BNS30_GK_Quiz_Sheet.pdf"
IH_PDF = HOME/"workspace/your_files/islamic-history-200-questions/islamic-history-200-questions.pdf"

def pdf_raw(pdf):
    out = subprocess.run(["pdftotext","-raw",str(pdf),"-"],capture_output=True,text=True)
    if out.returncode!=0: sys.exit(f"pdftotext failed for {pdf}: {out.stderr}")
    return out.stdout

def clean(s):
    for ch in ['\ufdfa','\u200e','\u200f','\u202a','\u202b','\u202c','\u202d','\u202e']:
        s=s.replace(ch,'')
    s=s.replace('\x0c',' ')
    return re.sub(r'\s+',' ',s).strip()

GK_HEADERS={"General Knowledge (1-35)","Islamic History (36-60)","World History (61-85)","Current Affairs (86-100)"}
def parse_dot(text, headers=set()):
    items={}; cur=None; buf=[]
    def flush():
        if cur is not None: items[cur]=clean(' '.join(buf))
    for line in text.splitlines():
        line=line.strip()
        if not line or line in headers: continue
        if line.startswith("Islamic History Questions"): continue
        m=re.match(r'^(\d{1,3})\.\s+(.*)$', line)
        if m: flush(); cur=int(m.group(1)); buf=[m.group(2)]
        elif cur is not None: buf.append(line)
    flush(); return items

def parse_ih_questions(text):
    items={}; cur=None; buf=[]
    def flush():
        if cur is not None: items[cur]=clean(' '.join(buf))
    for raw in text.splitlines():
        line=raw.strip().replace('\x0c','')
        if not line: continue
        if '·' in line and re.match(r'^\d\s', line): continue
        if line.startswith("Islamic History Questions"): continue
        m=re.match(r'^(\d{1,3})\s+(.*)$', line)
        if m: flush(); cur=int(m.group(1)); buf=[m.group(2)]
        elif cur is not None: buf.append(line)
    flush(); return items

def section_for(source, n):
    if source=="GK":
        if n<=35: return ("General Knowledge","General Knowledge")
        if n<=60: return ("Islamic History","Islamic History")
        if n<=85: return ("World History","World History")
        return ("Current Affairs","Current Affairs")
    if n<=40: return ("Seerah","Islamic History")
    if n<=70: return ("Prophets","Islamic History")
    if n<=100: return ("Rashidun Caliphs","Islamic History")
    if n<=125: return ("Ashara & Sahaba","Islamic History")
    if n<=155: return ("Umayyad & Abbasid","Islamic History")
    if n<=180: return ("Andalus & World","Islamic History")
    return ("Ottoman & Scholars","Islamic History")

def level_for(source, section):
    if source=="GK": return "Bidaya"
    if section in ("Seerah","Prophets","Rashidun Caliphs"): return "Bidaya"
    return "Ula"

def is_list_answer(a):
    return a.count(',')>=2 and ' and ' in a

def build(source, qs, ans):
    # group by section
    sections={}
    for n in sorted(qs):
        sec,cat=section_for(source,n)
        sections.setdefault(sec,[]).append(n)
    out=[]; skipped=[]
    for sec, nums in sections.items():
        pool=[]
        for n in nums:
            a=ans.get(n,"")
            if len(a)>90: skipped.append({"source":source,"number":n,"reason":f"answer too long ({len(a)} chars)","answer":a}); continue
            if is_list_answer(a): skipped.append({"source":source,"number":n,"reason":"multi-name list answer","answer":a}); continue
            pool.append(n)
        distinct=[]
        for n in pool:
            if ans[n] not in distinct: distinct.append(ans[n])
        for n in pool:
            rng=random.Random(f"{source}-{n}-v1")
            correct=ans[n]
            candidates=[a for a in distinct if a!=correct]
            rng.shuffle(candidates)
            distractors=candidates[:3]
            if len(distractors)<3:
                skipped.append({"source":source,"number":n,"reason":"fewer than 3 distinct distractors in section","answer":correct}); continue
            options=distractors+[correct]
            rng.shuffle(options)
            sec_name,cat=section_for(source,n)
            out.append({"source":source,"number":n,"section":sec_name,"category":cat,
                        "level":level_for(source,sec_name),"question":qs[n],"answer":correct,
                        "options":options,"correct_index":options.index(correct)})
    return out, skipped

def main():
    gk_txt=pdf_raw(GK_PDF); ih_txt=pdf_raw(IH_PDF)
    gk_idx=gk_txt.find("SIBAQ 26 - BNS30 GK Quiz - Answer Key")
    gk_q=parse_dot(gk_txt[:gk_idx], GK_HEADERS); gk_a=parse_dot(gk_txt[gk_idx:], GK_HEADERS)
    assert len(gk_q)==100 and len(gk_a)==100, (len(gk_q),len(gk_a))
    ih_idx=ih_txt.rfind("Answer Key")
    ih_q=parse_ih_questions(ih_txt[:ih_idx]); ih_a=parse_dot(ih_txt[ih_idx:])
    ih_a[210]=re.sub(r' Islamic History Questions.*$','',ih_a[210]).strip()
    assert len(ih_q)==210 and len(ih_a)==210, (len(ih_q),len(ih_a))
    # Validation against known facts
    assert ih_a[1]=="570 CE" and ih_a[2]=="Makkah" and ih_a[10]=="Cave Hira" and "2 AH" in ih_a[22], (ih_a[1],ih_a[2],ih_a[10],ih_a[22])
    gk_bank,gk_skip=build("GK",gk_q,gk_a)
    ih_bank,ih_skip=build("IslamicHistory",ih_q,ih_a)
    data={"generated_from":["SIBAQ26_BNS30_GK_Quiz_Sheet.pdf","islamic-history-200-questions.pdf"],
          "bank":gk_bank+ih_bank,"skipped":gk_skip+ih_skip}
    (ROOT/"seed-data.json").write_text(json.dumps(data,ensure_ascii=False,indent=1))
    print(f"GK seeded {len(gk_bank)} skipped {len(gk_skip)}")
    print(f"IH seeded {len(ih_bank)} skipped {len(ih_skip)}")
    for s in data["skipped"]: print("SKIP",s)
    from collections import Counter
    print(Counter((b['source'],b['section']) for b in data['bank']))

if __name__=="__main__": main()
