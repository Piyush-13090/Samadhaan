"""Event-loop blocking probe for the AI service (Prompt 27).

Sends one large /knowledge/chunk request and, at the same time, polls
/health every 20 ms. If CPU-bound work runs on the event loop, /health
latency jumps to roughly the chunking time while the request is in flight.

    python scripts/perf/ai-blocking-probe.py http://127.0.0.1:8101
"""
import json, statistics, sys, threading, time, urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8101"
paragraph = ("Clear storm drains before the monsoon. Inspect culverts weekly. "
             "Repair potholes within forty eight hours of a report. ") * 6
text = "\n\n".join(f"Section {i}. {paragraph}" for i in range(1700))[:990_000]
def make_pdf(pages: int) -> bytes:
    """A minimal multi-page text PDF (no dependencies), ~40 lines per page."""
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", None,
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for i in range(pages):
        lines = "".join(f"(Section {i}.{j} Clear storm drains and repair potholes promptly.) Tj T* "
                        for j in range(40))
        stream = f"BT /F1 9 Tf 11 TL 40 800 Td {lines} ET".encode()
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        content = len(objs)
        objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                    b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % content)
        kids.append(len(objs))
    objs[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    out = bytearray(b"%PDF-1.4\n"); offsets = []
    for n, o in enumerate(objs, 1):
        offsets.append(len(out)); out += b"%d 0 obj\n" % n + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)

import base64
mode = sys.argv[2] if len(sys.argv) > 2 else "pdf"
payload = ({"file_base64": base64.b64encode(make_pdf(400)).decode(), "mime_type": "application/pdf"}
           if mode == "pdf" else {"text": text, "mime_type": "text/plain"})
body = json.dumps({**payload, "max_tokens": 400,
                   "overlap_tokens": 40, "min_tokens": 40, "max_chunks": 10000}).encode()

def chunk():
    t0 = time.perf_counter()
    req = urllib.request.Request(f"{base}/knowledge/chunk", data=body,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read(); status = r.status
    chunk.elapsed = time.perf_counter() - t0; chunk.status = status

def health_latency():
    t0 = time.perf_counter()
    with urllib.request.urlopen(f"{base}/health", timeout=60) as r:
        r.read()
    return (time.perf_counter() - t0) * 1000

idle = [health_latency() for _ in range(20)]
t = threading.Thread(target=chunk); t.start()
busy = []
while t.is_alive():
    busy.append(health_latency()); time.sleep(0.02)
t.join()
print(json.dumps({
    "chunk_seconds": round(chunk.elapsed, 2), "chunk_status": chunk.status,
    "health_idle_p50_ms": round(statistics.median(idle), 1),
    "health_during_chunk_max_ms": round(max(busy), 1),
    "health_during_chunk_p50_ms": round(statistics.median(busy), 1),
    "health_samples_during_chunk": len(busy),
}))
