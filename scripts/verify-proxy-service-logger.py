"""Check the actual callback HTTP calls without a provider or a running proxy."""
import importlib.util
import asyncio
import os
import pathlib
import sys
import types

sdk = types.ModuleType('litellm.integrations.custom_logger')
sdk.CustomLogger = type('CustomLogger', (), {})
sys.modules['litellm'] = types.ModuleType('litellm')
sys.modules['litellm.integrations'] = types.ModuleType('litellm.integrations')
sys.modules['litellm.integrations.custom_logger'] = sdk
sdk_logging = types.ModuleType('litellm.litellm_core_utils.litellm_logging')
sdk_logging.Logging = type('Logging', (), {'_handle_anthropic_messages_response_logging': lambda self, result: result})
sdk_openai = types.ModuleType('litellm.types.llms.openai')
sdk_openai.ResponsesAPIResponse = type('ResponsesAPIResponse', (), {})
sys.modules[sdk_logging.__name__] = sdk_logging
sys.modules[sdk_openai.__name__] = sdk_openai
sys.modules['httpx'] = types.ModuleType('httpx')
sys.modules['yaml'] = types.ModuleType('yaml')
callback_path = pathlib.Path(__file__).resolve().parents[1] / 'litellm/clawnex_logger.py'
os.environ.pop('CLAWNEX_ON_SCAN_ERROR', None)
spec = importlib.util.spec_from_file_location('callback', callback_path)
callback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(callback)
secret = 'fixture-only-proxy-service-secret-32-bytes'
os.environ['CLAWNEX_INGEST_SECRET'] = secret
calls = []
status = 200
def response(url, **kwargs):
    assert {key.lower(): value for key, value in kwargs['headers'].items()} == {'x-clawnex-ingest-secret': secret}
    calls.append(url)
    return types.SimpleNamespace(status_code=status, text='fixture response', json=lambda: {
        'verdict': 'ALLOW', 'score': 0, 'detections': [], 'blockMode': 'on', 'active': False,
    })
callback.httpx.post = response
callback.httpx.get = response
async def run_hook(module):
    return await module.clawnex_logger_instance.async_pre_call_hook(
        types.SimpleNamespace(metadata={}), None,
        {'model': 'fixture-model', 'messages': [{'role': 'user', 'content': 'Reply with OK.'}]},
        'completion',
    )

assert asyncio.run(run_hook(callback)) is None
assert any(url.endswith('/api/break-glass/status') for url in calls)
assert any(url.endswith('/api/shield/scan') for url in calls)
print('PASS: public proxy hook authenticates internal calls and permits a scanned harmless prompt')

calls.clear()
status = 401
rejected = asyncio.run(run_hook(callback))
assert isinstance(rejected, str) and 'scan_error_fail_closed' in rejected
assert any(url.endswith('/api/proxy/block-mode') for url in calls)
assert any(url.endswith('/api/proxy/ingest') for url in calls)
print('PASS: failed internal authentication blocks at the public hook and attempts authenticated audit ingestion')

status = 503
os.environ['CLAWNEX_ON_SCAN_ERROR'] = 'allow'
allow_spec = importlib.util.spec_from_file_location('callback_allow', callback_path)
allow_callback = importlib.util.module_from_spec(allow_spec)
allow_spec.loader.exec_module(allow_callback)
calls.clear()
assert asyncio.run(run_hook(allow_callback)) is None
assert any(url.endswith('/api/shield/scan') for url in calls)
assert not any(url.endswith('/api/proxy/ingest') for url in calls)
print('PASS: explicitly selected scanner-error allow policy permits the existing proxy path, without a fabricated scan or bypass activation')
