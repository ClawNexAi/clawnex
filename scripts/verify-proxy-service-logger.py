"""Check the actual callback HTTP calls without a provider or a running proxy."""
import importlib.util
import os
import pathlib
import sys
import types

sdk = types.ModuleType('litellm.integrations.custom_logger')
sdk.CustomLogger = type('CustomLogger', (), {})
sys.modules['litellm'] = types.ModuleType('litellm')
sys.modules['litellm.integrations'] = types.ModuleType('litellm.integrations')
sys.modules['litellm.integrations.custom_logger'] = sdk
sys.modules['httpx'] = types.ModuleType('httpx')
sys.modules['yaml'] = types.ModuleType('yaml')
spec = importlib.util.spec_from_file_location('callback', pathlib.Path(__file__).resolve().parents[1] / 'litellm/clawnex_logger.py')
callback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(callback)
secret = 'fixture-only-proxy-service-secret-32-bytes'
os.environ['CLAWNEX_INGEST_SECRET'] = secret
calls = []
def response(url, **kwargs):
    assert kwargs['headers'] == {'x-clawnex-ingest-secret': secret}
    calls.append(url)
    return types.SimpleNamespace(status_code=200, json=lambda: {
        'verdict': 'ALLOW', 'score': 0, 'detections': [], 'blockMode': 'on', 'active': False,
    })
callback.httpx.post = response
callback.httpx.get = response
assert callback._scan('Reply with OK.')['verdict'] == 'ALLOW'
assert callback._is_block_mode_on() is True
assert callback._is_break_glass_active() is False
assert len(calls) == 3
callback._fail_closed = lambda: True
callback.httpx.post = callback.httpx.get = lambda *args, **kwargs: types.SimpleNamespace(status_code=401)
assert callback._scan('Reply with OK.')['verdict'] == 'BLOCK'
assert callback._is_block_mode_on() is True
assert callback._is_break_glass_active() is False
print('PASS: all internal calls authenticate; failed authentication remains fail-closed')
