"""Real installed LiteLLM + disposable loopback upstream/scanner. No paid calls."""
import json
import os
import pathlib
import socket
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRET = 'fixture-only-routing-identity-secret-32-bytes'
records = []
policy = {'bypass': False, 'scanner_failure': False, 'block': False, 'upstream_calls': 0}

class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, value):
        raw = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.reply({'active': policy['bypass'], 'blockMode': 'on', 'status': 'ok'})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        if self.path == '/api/proxy/ingest':
            assert self.headers.get('x-clawnex-ingest-secret') == SECRET
            records.append(body)
            self.reply({'ok': True, 'id': str(uuid.uuid4())})
        elif self.path == '/api/shield/scan':
            if policy['scanner_failure']:
                self.send_response(503)
                self.end_headers()
            else:
                self.reply({'verdict': 'BLOCK' if policy['block'] else 'ALLOW', 'score': 100 if policy['block'] else 0, 'detections': []})
        else:
            assert not self.headers.get('x-clawnex-routing-identity'), 'Instance identity must not be forwarded upstream'
            policy['upstream_calls'] += 1
            if body.get('stream'):
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                completion_id = 'chatcmpl-' + str(uuid.uuid4())
                for delta, finish in [({'role': 'assistant', 'content': 'Fixture OK'}, None), ({}, 'stop')]:
                    chunk = {'id': completion_id, 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'fixture-model', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                    self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
                return
            self.reply({'id': 'chatcmpl-' + str(uuid.uuid4()), 'object': 'chat.completion', 'created': int(time.time()),
                        'model': 'fixture-model', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'Fixture OK'}, 'finish_reason': 'stop'}],
                        'usage': {'prompt_tokens': 3, 'completion_tokens': 2, 'total_tokens': 5}})

def get_json(url, body=None, headers=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
threading.Thread(target=fixture.serve_forever, daemon=True).start()
fixture_port = fixture.server_address[1]
with socket.socket() as reserved:
    reserved.bind(('127.0.0.1', 0))
    proxy_port = reserved.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='clawnex-native-routing-') as temp:
    # LiteLLM resolves custom callbacks relative to the chosen YAML file.
    shutil.copyfile(ROOT / 'litellm/clawnex_logger.py', pathlib.Path(temp) / 'clawnex_logger.py')
    config = pathlib.Path(temp) / 'proxy.yaml'
    # JSON is valid YAML. The only upstream is our disposable local HTTP fixture.
    config.write_text(json.dumps({'model_list': [{'model_name': 'fixture-model', 'litellm_params': {
        'model': 'openai/fixture-model', 'api_base': f'http://127.0.0.1:{fixture_port}/v1', 'api_key': 'fixture'},
        'model_info': {'x_clawnex_revision': 'fixture-revision'}}],
        'litellm_settings': {'callbacks': ['clawnex_logger.clawnex_logger_instance']}, 'general_settings': {'master_key': None}}))
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'TMPDIR') if key in os.environ}
    env.update({'PYTHONPATH': str(ROOT / 'litellm'), 'CLAWNEX_API_URL': f'http://127.0.0.1:{fixture_port}',
                'CLAWNEX_INGEST_SECRET': SECRET, 'LITELLM_CONFIG_PATH': str(config), 'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'LITELLM_LOG': 'ERROR'})
    with (pathlib.Path(temp) / 'proxy.log').open('w+') as logs:
        process = subprocess.Popen([str(ROOT / 'litellm/venv/bin/litellm'), '--config', str(config), '--host', '127.0.0.1', '--port', str(proxy_port)],
                                   cwd=temp, env=env, stdout=logs, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while True:
                try:
                    get_json(f'http://127.0.0.1:{proxy_port}/health/liveliness')
                    break
                except Exception:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Disposable LiteLLM did not start')
                    time.sleep(0.25)
            info = get_json(f'http://127.0.0.1:{proxy_port}/model/info')
            assert info['data'][0]['model_info']['x_clawnex_revision'] == 'fixture-revision'
            for connector in ['openclaw', 'hermes', 'opencode']:
                for source in ['instance-a', 'instance-b']:
                    expression = "import {createRoutingIdentity} from './src/lib/services/routing-identity'; console.log(createRoutingIdentity(process.argv[1] as any, process.argv[2])!.token)"
                    token_env = dict(env)
                    token = subprocess.check_output(['npx', 'tsx', '-e', expression, connector, source], cwd=ROOT, env=token_env, text=True).strip()
                    result = get_json(f'http://127.0.0.1:{proxy_port}/v1/chat/completions',
                        {'model': 'fixture-model', 'messages': [{'role': 'user', 'content': 'Fixture hello'}]}, {'x-clawnex-routing-identity': token})
                    assert result['choices'][0]['message']['content'] == 'Fixture OK'
            deadline = time.monotonic() + 10
            while len(records) < 6 and time.monotonic() < deadline:
                time.sleep(0.1)
            assert {(row.get('routing_connector'), row.get('routing_source_id')) for row in records} == {
                ('openclaw', 'instance-a'), ('openclaw', 'instance-b'), ('hermes', 'instance-a'), ('hermes', 'instance-b'),
                ('opencode', 'instance-a'), ('opencode', 'instance-b')}, records
            assert all(row.get('routing_identity_hash') and row.get('proxy_request_id') for row in records)
            print('PASS: native LiteLLM preserves loaded revision and signed identities for three tools/two instances using one model')
            stream_request = urllib.request.Request(f'http://127.0.0.1:{proxy_port}/v1/chat/completions',
                data=json.dumps({'model': 'fixture-model', 'stream': True, 'messages': [{'role': 'user', 'content': 'Fixture stream'}]}).encode(),
                headers={'Content-Type': 'application/json', 'x-clawnex-routing-identity': token})
            with urllib.request.urlopen(stream_request, timeout=10) as streamed:
                assert b'Fixture OK' in streamed.read()
            deadline = time.monotonic() + 10
            while len(records) < 7 and time.monotonic() < deadline:
                time.sleep(0.1)
            assert len(records) == 7 and records[-1].get('routing_source_id') == 'instance-b' and records[-1].get('proxy_request_id'), 'A completed stream must retain attributable evidence'
            print('PASS: streamed completion retains instance evidence; signed headers never reach the upstream')
            before = policy['upstream_calls']
            for failure in ['block', 'scanner_failure']:
                policy[failure] = True
                try:
                    get_json(f'http://127.0.0.1:{proxy_port}/v1/chat/completions', {'model': 'fixture-model', 'messages': [{'role': 'user', 'content': 'Fixture policy test'}]})
                    raise AssertionError('The fixture request must fail closed')
                except urllib.error.HTTPError:
                    pass
                finally:
                    policy[failure] = False
                assert policy['upstream_calls'] == before, 'Blocked/failed scanner traffic must not reach the upstream'
            for endpoint, payload in [
                ('responses', {'input': 'Fixture native policy test'}),
                ('messages', {'messages': [{'role': 'user', 'content': 'Fixture native policy test'}], 'max_tokens': 16}),
            ]:
                policy['block'] = True
                rows_before = len(records)
                try:
                    get_json(f'http://127.0.0.1:{proxy_port}/v1/{endpoint}', {'model': 'fixture-model', **payload}, {'x-clawnex-routing-identity': token})
                    raise AssertionError('Native request must fail closed')
                except urllib.error.HTTPError:
                    pass
                finally:
                    policy['block'] = False
                assert policy['upstream_calls'] == before, endpoint
                assert any(row.get('blocked') and row.get('routing_source_id') == 'instance-b' for row in records[rows_before:]), endpoint
            print('PASS: Responses and Messages are blocked before upstream with signed instance evidence')
            policy['bypass'] = True
            get_json(f'http://127.0.0.1:{proxy_port}/v1/chat/completions', {'model': 'fixture-model', 'messages': [{'role': 'user', 'content': 'Fixture bypass test'}]}, {'x-clawnex-routing-identity': token})
            assert policy['upstream_calls'] == before + 1
            deadline = time.monotonic() + 10
            while not any(row.get('shield_verdict') == 'BYPASSED' and row.get('direction') == 'outbound' for row in records) and time.monotonic() < deadline:
                time.sleep(0.1)
            bypassed = [row for row in records if row.get('shield_verdict') == 'BYPASSED']
            assert bypassed and all(not row.get('routing_source_id') for row in bypassed)
            print('PASS: real proxy blocks policy failures and scanner outages; manual bypass forwards without claiming verified protection')
        except Exception:
            logs.flush()
            logs.seek(0)
            print(logs.read()[-12000:])  # contains disposable fixture values only
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
fixture.shutdown()
