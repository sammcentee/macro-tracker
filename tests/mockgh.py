# A fake GitHub Contents API for sync tests. It keeps one data.json in memory.
# Run: python3 -I tests/mockgh.py 8767, then point the app's fetch at http://127.0.0.1:8767.
# /__state shows the file, /__reset clears it, PUT /__set stores a raw body,
# /__conflict makes the next PUT lose a race to another device.
import base64, hashlib, http.server, json, sys
state = {'content': None, 'puts': 0, 'conflict': False}
sha = lambda b: hashlib.sha1(b).hexdigest()
class H(http.server.BaseHTTPRequestHandler):
    def send(self, code, obj=None):
        body = json.dumps(obj).encode() if obj is not None else b''
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-GitHub-Api-Version')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Content-Type', 'application/json')
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.send(204)
    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/__state':
            c = state['content']
            return self.send(200, {'puts': state['puts'], 'data': json.loads(c) if c else None})
        if p == '/__reset': state.update(content=None, puts=0, conflict=False); return self.send(200, {})
        if p == '/__conflict': state['conflict'] = True; return self.send(200, {})
        if p.endswith('/contents/data.json'):
            c = state['content']
            if c is None: return self.send(404, {'message': 'Not Found'})
            return self.send(200, {'sha': sha(c), 'encoding': 'base64', 'content': base64.encodebytes(c).decode()})
        if p.count('/') == 3 and p.startswith('/repos/'): return self.send(200, {'full_name': p[7:]})
        self.send(404, {'message': 'Not Found'})
    def do_PUT(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
        if self.path == '/__set':
            state['content'] = body; return self.send(200, {})
        req = json.loads(body)
        if state['conflict']:
            state['conflict'] = False
            d = json.loads(state['content'])
            d['entries'].append({'id': 'zz-other-device', 'date': '2026-11-06', 'time': '2026-11-06T08:00:00.000Z', 'name': 'Other device',
                                 'grams': None, 'foodId': None, 'kcal': 77, 'protein': 0, 'carbs': 0, 'fat': 0, 'updatedAt': '2026-11-06T08:00:00.000Z'})
            state['content'] = json.dumps(d).encode()
        cur = state['content']
        if cur is not None and req.get('sha') != sha(cur): return self.send(409, {'message': 'sha mismatch'})
        if cur is None and req.get('sha'): return self.send(422, {'message': 'sha given for new file'})
        state['content'] = base64.b64decode(req['content']); state['puts'] += 1
        self.send(201 if cur is None else 200, {'content': {'sha': sha(state['content'])}})
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
