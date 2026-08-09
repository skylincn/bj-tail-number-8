#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检查今天是否为车牌 1068（尾号 8）的北京限行日，并在限行日弹出「必须点击才消失」的提醒。

判定逻辑完全复用仓库生成的 dist/plate-8.ics（北京尾号8限行日历），
因此限行星期每季度轮换、法定节假日/周末自动排除，本脚本无需维护。

用法：
  python3 check_limit_today.py            # 限行日弹窗提醒（给 launchd 调用）
  python3 check_limit_today.py --dry-run  # 只打印结论，不弹窗
  python3 check_limit_today.py --test 2026-08-12  # 测试指定日期
"""

import sys
import re
import datetime
import urllib.request

# 限行日历源（始终取最新，含法定节假日与季度轮换）
ICS_URL = "https://raw.githubusercontent.com/skylincn/bj-tail-number-8/main/dist/plate-8.ics"

# BYDAY 星期码 -> Python weekday()（周一=0 ... 周日=6）
BYDAY_TO_WEEKDAY = {
    "MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6,
}


def fetch_ics():
    """下载最新 ICS，失败则回退本地文件。"""
    try:
        req = urllib.request.Request(ICS_URL, headers={"User-Agent": "bj-tail-number"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        local = "/Users/skymini/Documents/workbuddy/Code/beijing-plate-limit-1068/dist/plate-8.ics"
        try:
            with open(local, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            sys.stderr.write("无法获取限行日历: %s\n" % e)
            sys.exit(2)


def parse_events(ics_text):
    """解析所有 VEVENT，返回 [(start_date, until_date, set(weekdays))] 列表。"""
    events = []
    # 按 VEVENT 分块
    blocks = re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", ics_text, re.DOTALL)
    for block in blocks:
        dtstart = re.search(r"DTSTART[^:]*:(\d{8})T", block)
        rrule = re.search(r"RRULE:(.*?)(?:\r?\n)", block)
        if not dtstart:
            continue
        start_date = datetime.datetime.strptime(dtstart.group(1), "%Y%m%d").date()

        weekdays = set()
        until_date = None
        if rrule:
            m_byday = re.search(r"BYDAY=([A-Z,]+)", rrule.group(1))
            m_until = re.search(r"UNTIL=(\d{8})T", rrule.group(1))
            if m_byday:
                for code in m_byday.group(1).split(","):
                    if code in BYDAY_TO_WEEKDAY:
                        weekdays.add(BYDAY_TO_WEEKDAY[code])
            if m_until:
                until_date = datetime.datetime.strptime(m_until.group(1), "%Y%m%d").date()

        if weekdays:
            events.append((start_date, until_date, weekdays))
    return events


def is_restriction_day(target, events):
    """target 是否在某个限行事件的周期内且星期匹配。"""
    for start_date, until_date, weekdays in events:
        if target < start_date:
            continue
        if until_date and target > until_date:
            continue
        if target.weekday() in weekdays:
            return True
    return False


def show_alert(target):
    """弹出必须点击才消失的提醒（osascript alert 模态对话框）。"""
    msg = "1068（尾号 8）今天北京限行，07:00–20:00 别开这辆车。"
    script = 'display alert "🚫 今天尾号8限行" message "%s" as warning' % msg
    try:
        import subprocess
        subprocess.run(["osascript", "-e", script], check=False)
    except Exception as e:
        sys.stderr.write("弹窗失败: %s\n" % e)


def main():
    test_date = None
    dry_run = False
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--dry-run":
            dry_run = True
        elif a == "--test":
            test_date = datetime.datetime.strptime(args[i + 1], "%Y-%m-%d").date()

    target = test_date or datetime.date.today()
    ics = fetch_ics()
    events = parse_events(ics)
    restriction = is_restriction_day(target, events)

    weekday_cn = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][target.weekday()]
    print("%s（%s）%s限行日" % (target.isoformat(), weekday_cn, "是" if restriction else "不是"))

    if restriction:
        if dry_run:
            print("[dry-run] 限行日，本应弹窗提醒")
        else:
            show_alert(target)
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
