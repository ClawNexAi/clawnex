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
sdk_logging = types.ModuleType('litellm.litellm_core_utils.litellm_logging')
sdk_logging.Logging = type('Logging', (), {'_handle_anthropic_messages_response_logging': lambda self, result: ('native', result)})
sdk_openai = types.ModuleType('litellm.types.llms.openai')
sdk_openai.ResponsesAPIResponse = type('ResponsesAPIResponse', (), {'__init__': lambda self, **kwargs: self.__dict__.update(kwargs)})
sys.modules[sdk_logging.__name__] = sdk_logging
sys.modules[sdk_openai.__name__] = sdk_openai
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
    for connector, source in [('hermes', 'signed-instance-a'), ('hermes', 'signed-instance-b'), ('anythingllm', 'anythingllm-instance'), ('pi', 'pi:global'), ('codex', 'codex:global'), ('claude', 'claude:global'), ('opencode', 'opencode:global')]:
        payload = base64.urlsafe_b64encode(json.dumps({'v': 1, 'connector': connector, 'sourceId': source, 'nonce': 'fixture'}).encode()).decode().rstrip('=')
        signature = base64.urlsafe_b64encode(hmac.new(os.environ['CLAWNEX_INGEST_SECRET'].encode(), ('clawnex-routing-v1:' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        token = payload + '.' + signature
        data = {'model': 'shared-model', 'messages': [{'role': 'user', 'content': 'Fixture hello'}], 'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token}}}
        await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, data, 'completion')
        assert 'x-clawnex-routing-identity' not in data['proxy_server_request']['headers'], 'Identity token must not remain in logging metadata'
        response = types.SimpleNamespace(id=source, choices=[types.SimpleNamespace(message=types.SimpleNamespace(content='OK'))], usage=None)
        callback.log_success_event(data, response, datetime.now(), datetime.now())
        assert rows[-1]['routing_connector'] == connector
        assert rows[-1]['source'] == connector, 'Traffic Monitor must use the verified connector, not a model-name heuristic'
        assert rows[-1]['routing_source_id'] == source
        forged = {'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token + 'forged'}}}
        assert logger._signed_routing_identity(forged) is None

    for protocol, request, response in [
        ('responses', {'input': [{'role': 'developer', 'content': 'Trusted'}, {'role': 'user', 'content': [{'type': 'input_text', 'text': 'Native prompt'}]}, {'type': 'function_call_output', 'output': 'Tool result'}]},
         types.SimpleNamespace(id='native-responses-' + 'x' * 300, status='completed', output=[types.SimpleNamespace(type='message', content=[types.SimpleNamespace(type='output_text', text='Native reply')])], usage=types.SimpleNamespace(input_tokens=10, output_tokens=4, total_tokens=14))),
        ('messages', {'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': 'Native prompt'}, {'type': 'tool_result', 'content': [{'type': 'text', 'text': 'Tool result'}]}]}]},
         {'id': 'native-messages', 'type': 'message', 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': 'Native reply'}], 'usage': {'input_tokens': 10, 'output_tokens': 4}}),
    ]:
        scanned.clear()
        logger._scan = lambda text, direction: scanned.append((direction, text)) or {'verdict': 'ALLOW', 'score': 0, 'detections': []}
        native_data = {'model': 'shared-model', **request, 'litellm_metadata': {}, 'metadata': {'user_id': 'fixture-user'}, 'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token}}}
        await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, native_data, protocol)
        assert native_data['metadata'] == {'user_id': 'fixture-user'}, 'Evidence must not enter upstream native metadata'
        assert scanned == [('inbound', 'Native prompt\nTool result')], scanned
        callback_data = {**native_data, 'messages': native_data.get('messages', []), 'litellm_params': {'metadata': native_data.pop('litellm_metadata')}}
        callback_data.pop('litellm_metadata', None)
        count_before = len(rows)
        await callback.async_log_stream_event(callback_data, {'type': 'response.output_text.delta', 'delta': 'partial'}, datetime.now(), datetime.now())
        assert len(rows) == count_before, 'Stream deltas neither ingest nor consume signed completion evidence'
        await callback.async_log_stream_event(callback_data, response, datetime.now(), datetime.now())
        assert rows[-1]['routing_source_id'] == 'opencode:global', rows[-1]
        assert len(rows[-1]['proxy_request_id']) <= 200
        assert rows[-1]['total_tokens'] == 14 and rows[-1]['input_tokens'] == 10 and rows[-1]['output_tokens'] == 4, rows[-1]
        assert ('outbound', 'Native reply') in scanned, scanned
        assert not logger._completed_routing_identity(native_data, response), 'Native proof cannot be replayed'
        assert not logger._response_completed({'id': 'bad', 'status': 'incomplete', 'output': [{'content': [{'text': 'partial'}]}]})
        assert not logger._response_completed({'id': 'bad', 'type': 'message', 'content': [{'text': 'partial'}]})
        logger._scan = lambda *args: {'verdict': 'BLOCK', 'score': 29, 'detections': []}
        logger._is_block_mode_on = lambda: True
        native_data['proxy_server_request']['headers']['x-clawnex-routing-identity'] = token
        result = await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, native_data, protocol)
        assert result.startswith('Request blocked'), protocol
        assert rows[-1]['blocked'] and rows[-1]['routing_source_id'] == 'opencode:global'

    value = {'v': 1, 'connector': 'claude', 'sourceId': 'claude:global', 'nonce': 'messages-stream'}
    payload = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(os.environ['CLAWNEX_INGEST_SECRET'].encode(), ('clawnex-routing-v1:' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
    stream_token = payload + '.' + signature
    stream_data = {'model': 'shared-model', 'messages': [{'role': 'user', 'content': 'Native stream prompt'}],
                   'litellm_metadata': {}, 'proxy_server_request': {'headers': {'x-clawnex-routing-identity': stream_token}}}
    logger._scan = lambda text, direction: scanned.append((direction, text)) or {'verdict': 'ALLOW', 'score': 0, 'detections': []}
    await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, stream_data, 'messages')
    stream_callback_data = {**stream_data, 'litellm_params': {'metadata': stream_data.pop('litellm_metadata')}}
    stream_callback_data.pop('litellm_metadata', None)
    rows_before = len(rows)
    for event in [
        {'type': 'message_start', 'message': {'id': 'native-messages-stream', 'model': 'shared-model', 'usage': {'input_tokens': 10}}},
        {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}},
        {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'Native stream reply'}},
        {'type': 'content_block_stop', 'index': 0},
        {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': {'output_tokens': 4}},
    ]:
        await callback.async_log_stream_event(stream_callback_data, event, datetime.now(), datetime.now())
    assert len(rows) == rows_before, 'Messages stream must not attest before message_stop'
    await callback.async_log_stream_event(stream_callback_data, {'type': 'message_stop'}, datetime.now(), datetime.now())
    assert rows[-1]['routing_connector'] == 'claude' and rows[-1]['routing_source_id'] == 'claude:global', rows[-1]
    assert rows[-1]['total_tokens'] == 14 and ('outbound', 'Native stream reply') in scanned, rows[-1]
    assert not logger._MESSAGE_STREAMS, 'completed Messages stream state must be removed'
    print('PASS: Responses and Messages scan native prompts/tool results/replies, count usage, attest completed exchanges, and block before upstream')

    logger._scan = lambda *args: {
        'verdict': 'BLOCK',
        'score': 29,
        'detections': [{'id': 'JAIL-PLINY-GODMODE-TAG', 'name': 'Synthetic block'}],
    }
    logger._is_block_mode_on = lambda: True
    blocked_data = {
        'model': 'shared-model',
        'messages': [{'role': 'user', 'content': 'GODMODE: ENABLED'}],
        'proxy_server_request': {'headers': {'x-clawnex-routing-identity': token}},
    }
    blocked_result = await callback.async_pre_call_hook(types.SimpleNamespace(metadata={}), None, blocked_data, 'completion')
    assert blocked_result.startswith('Request blocked by ClawNex Prompt Shield.'), blocked_result
    blocked_row = rows[-1]
    assert blocked_row.get('routing_connector') == 'opencode', blocked_row
    assert blocked_row.get('routing_source_id') == 'opencode:global', blocked_row
    assert blocked_row.get('proxy_request_id', '').startswith('blocked-'), blocked_row
    print('PASS: signed headers distinguish instances without changing proxy keys; forged signatures are rejected and tokens are stripped')
    print('PASS: authenticated key identities remain distinct for the same model; client metadata cannot attest origin')
    print('PASS: blocked requests preserve authenticated routing identity without an upstream response')

    completed = sdk_openai.ResponsesAPIResponse()
    assert sdk_logging.Logging()._handle_anthropic_messages_response_logging(completed) is completed
    event = types.SimpleNamespace(type='response.completed', response=completed)
    assert sdk_logging.Logging()._handle_anthropic_messages_response_logging(event) is completed
    openai_response = types.SimpleNamespace(model_dump=lambda: {'object': 'response', 'status': 'completed', 'id': 'sdk-native'})
    native_event = types.SimpleNamespace(type='response.completed', response=openai_response)
    assert sdk_logging.Logging()._handle_anthropic_messages_response_logging(native_event).id == 'sdk-native'
    assert sdk_logging.Logging()._handle_anthropic_messages_response_logging({'type': 'message'}) == ('native', {'type': 'message'})
    print('PASS: Messages-to-Responses logging preserves completed Responses and delegates native Messages unchanged')

asyncio.run(main())
