#!/bin/bash
# 限行日判定（供 iPhone/macOS 快捷指令「运行脚本」动作调用）
# 输出：限行日输出 "YES"，非限行日输出 "NO"
# 逻辑复用仓库 dist/plate-8.ics（北京尾号8限行日历），节假日/换周期自动同步。

PYCODE='
import sys, re, datetime, urllib.request
ICS_URL="https://raw.githubusercontent.com/skylincn/bj-tail-number-8/main/dist/plate-8.ics"
BY={"MO":0,"TU":1,"WE":2,"TH":3,"FR":4,"SA":5,"SU":6}
def fetch():
    try:
        req=urllib.request.Request(ICS_URL,headers={"User-Agent":"bj-tail"})
        with urllib.request.urlopen(req,timeout=15) as r: return r.read().decode("utf-8")
    except Exception:
        try:
            return open("/Users/skymini/Documents/workbuddy/Code/beijing-plate-limit-1068/dist/plate-8.ics").read()
        except Exception:
            return ""
ics=fetch()
today=datetime.date.today()
for blk in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT",ics,re.DOTALL):
    ds=re.search(r"DTSTART[^:]*:(\d{8})T",blk)
    rr=re.search(r"RRULE:(.*?)(?:\r?\n)",blk)
    if not ds: continue
    sd=datetime.datetime.strptime(ds.group(1),"%Y%m%d").date()
    wd=set(); until=None
    if rr:
        m=re.search(r"BYDAY=([A-Z,]+)",rr.group(1));
        u=re.search(r"UNTIL=(\d{8})T",rr.group(1))
        if m:
            for c in m.group(1).split(","):
                if c in BY: wd.add(BY[c])
        if u: until=datetime.datetime.strptime(u.group(1),"%Y%m%d").date()
    if today<sd: continue
    if until and today>until: continue
    if today.weekday() in wd:
        print("YES"); sys.exit(0)
print("NO")
'
python3 -c "$PYCODE"
