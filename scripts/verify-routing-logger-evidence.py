"""Exercise the real callback with stubbed network and optional LiteLLM SDK."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import json
import hmac
import hashlib
import base64
import os
from datetime import datetime

# No model SDK or network is needed to prove the callback's identity boundary.
custom_logger = types.ModuleType('litellm.integrations.custom_logger')
custom_logger.CustomLogger = type('CustomLogger', (), {})
sys.modules['litellm'] = types.ModuleType('litellm')
sys.modules['litellm.integrations'] = types.ModuleType('litellm.integrations')
sys.modules['litellm.integrations.custom_logger'] = custom_logger
sys.modules['httpx'] = types.ModuleType('httpx')
sys.modules['yaml'] = types.ModuleType('yaml')
spec = importlib.util.spec_from_file_location('routing_logger_fixture', pathlib.Path(__file__).resolve().parents[1] / 'litellm/clawnex_logger.py')
logger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logger)
logger._is_break_glass_active = lambda: False
logger._block_mode_on = lambda: True
logger._scan = lambda *args: {'verdict': 'ALLOW', 'score': 0, 'detections': []}
logger._source_for = lambda *args: 'hermes'
rows = []
logger._ingest = rows.append

async def main():
    callback = logger.ClawNexLogger()
    scanned = []
    logger._scan = lambda text, direction: scanned.append((direction, text)) or {'verdict': 'ALLOW', 'score': 0, 'detections': []}
    role_data = {'model': 'shared-model', 'messages': [
        {'role': 'system', 'content': 'Trusted agent instructions mention jailbreak, CLAUDE.md, and sudo.'},
        {'role': 'developer', 'content': 'Trusted developer instructions.'},
        {'role': 'assistant', 'content': 'Previously scanned assistant response.'},
        {'role': 'user', 'content': 'Benign user request.'},
        {'role': 'tool', 'content': 'Untrusted tool result.'},
    ]}
    await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, role_data, 'completion')
    assert scanned == [('inbound', 'Benign user request.\nUntrusted tool result.')], scanned
    logger._scan = lambda *args: {'verdict': 'ALLOW', 'score': 0, 'detections': []}
    for source, trusted in [('instance-a', True), ('instance-b', True), ('forged-client', False)]:
        data = {'model': 'shared-model', 'messages': [{'role': 'user', 'content': 'Fixture hello'}],
                'metadata': {'clawnex_connector': 'hermes', 'clawnex_routing_source_id': source, 'clawnex_evidence_handle': 'forged'}}
        auth = types.SimpleNamespace(metadata={'clawnex_routing_connector': 'hermes', 'clawnex_routing_source_id': source} if trusted else {})
        await callback.async_pre_call_hook(auth, None, data, 'completion')
        response = types.SimpleNamespace(id='request-' + source, choices=[types.SimpleNamespace(message=types.SimpleNamespace(content='OK'))], usage=None)
        callback.log_success_event(data, response, datetime.now(), datetime.now())
        row = rows[-1]
        assert row.get('routing_source_id') == (source if trusted else None), row
        assert row.get('proxy_request_id') == (response.id if trusted else None), row
    assert not logger._completed_routing_identity(data, response), 'A consumed/forged identity cannot be replayed'
    os.environ['CLAWNEX_INGEST_SECRET'] = 'fixture-only-routing-identity-secret-32-bytes'
    for connector, source in [('hermes', 'signed-instance-a'), ('hermes', 'signed-instance-b'), ('opencode', 'opencode:global')]:
        payload = base64.urlsafe_b64encode(json.dumps({'v': 1, 'connector': connector, 'sourceId': source, 'nonce': 'fixture'}).encode()).decode().rstrip('=')
        signature = base64.urlsafe_b64encode(hmac.new(os.environ['CLAWNEX_INGEST_SECRET'].encode(), ('clawnex-routing-v1:' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        token = payload + '.' + signature
        data = {'model': 'shared-model', 'messages': [{'role': 'user', 'content': 'Fixture hello'}], 'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token}}}
        await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, data, 'completion')
        assert 'x-clawnex-routing-identity' not in data['proxy_server_request']['headers'], 'Identity token must not remain in logging metadata'
        response = types.SimpleNamespace(id=source, choices=[types.SimpleNamespace(message=types.SimpleNamespace(content='OK'))], usage=None)
        callback.log_success_event(data, response, datetime.now(), datetime.now())
        assert rows[-1]['routing_connector'] == connector
        assert rows[-1]['routing_source_id'] == source
        forged = {'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token + 'forged'}}}
        assert logger._signed_routing_identity(forged) is None
    print('PASS: signed headers distinguish instances without changing proxy keys; forged signatures are rejected and tokens are stripped')
    print('PASS: authenticated key identities remain distinct for the same model; client metadata cannot attest origin')

asyncio.run(main())
