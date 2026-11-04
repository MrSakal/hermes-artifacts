"""Evaluate JS in a Hermes Desktop target over CDP (dev/diagnostics helper).

    python scripts/cdp_eval.py [--port 9222] [--target index.html|8798] [--console] "<js expression>"

--target matches a substring of the page or iframe URL (iframes are reached via auto-attach,
so sandboxed out-of-process artifact frames work too). --console prints console/exception
events captured for ~1 s after attaching.
"""
import argparse
import asyncio
import json
import sys
import urllib.request

import websockets


async def run(port, target, expr, want_console):
    ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2))
    async with websockets.connect(ver["webSocketDebuggerUrl"], max_size=None) as ws:
        seq, waiters, attached, logs = 0, {}, [], []

        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if m.get("id") in waiters:
                    waiters.pop(m["id"]).set_result(m)
                elif m.get("method") == "Target.attachedToTarget":
                    attached.append(m["params"])
                elif m.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"):
                    logs.append(m)
        t = asyncio.create_task(reader())

        async def cmd(method, params=None, sid=None):
            nonlocal seq
            seq += 1
            fut = asyncio.get_running_loop().create_future()
            waiters[seq] = fut
            msg = {"id": seq, "method": method, "params": params or {}}
            if sid:
                msg["sessionId"] = sid
            await ws.send(json.dumps(msg))
            r = await asyncio.wait_for(fut, 20)
            if "error" in r:
                raise RuntimeError(r["error"])
            return r["result"]

        await cmd("Target.setDiscoverTargets", {"discover": True})
        targets = (await cmd("Target.getTargets"))["targetInfos"]
        page = next((x for x in targets if x["type"] == "page" and "devtools" not in x["url"]), None)
        s = (await cmd("Target.attachToTarget", {"targetId": page["targetId"], "flatten": True}))["sessionId"]
        await cmd("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": False, "flatten": True}, s)
        await asyncio.sleep(0.6)
        sid = s
        if target and target not in page["url"]:
            hits = [a for a in attached if target in a["targetInfo"]["url"]]
            if not hits:
                print(json.dumps({"error": f"no target matching {target!r}",
                                  "frames": [a["targetInfo"]["url"] for a in attached]}))
                return
            sid = hits[-1]["sessionId"]
        await cmd("Runtime.enable", sid=sid)
        await asyncio.sleep(1.0 if want_console else 0.1)
        r = await cmd("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, sid)
        out = r["result"].get("value", r["result"].get("description"))
        if "exceptionDetails" in r:
            out = {"exception": r["exceptionDetails"].get("exception", {}).get("description")}
        print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
        if want_console:
            for m in logs[-30:]:
                p = m["params"]
                if m["method"] == "Runtime.consoleAPICalled":
                    print(p["type"], " ".join(str(a.get("value", a.get("description", ""))) for a in p["args"])[:400])
                else:
                    print(m["method"], json.dumps(p)[:400])
        t.cancel()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--target", default="")
    ap.add_argument("--console", action="store_true")
    ap.add_argument("expr")
    a = ap.parse_args()
    asyncio.run(run(a.port, a.target, a.expr, a.console))
