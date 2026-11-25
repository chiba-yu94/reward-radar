import io
import json
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from unittest.mock import Mock, patch

from radar import api_smoke
from radar.pipeline import ROOT, stamp

ENABLED = {
    'FREEBIE_TRAIL_API_SMOKE_ENABLED': 'true',
    'FREEBIE_TRAIL_API_SMOKE_CONFIRMED': 'true',
    'FREEBIE_TRAIL_API_SMOKE_SLOT': 'true',
    'FREEBIE_TRAIL_API_SMOKE_JST_DAY': datetime.now(api_smoke.JST).date().isoformat(),
    'GITHUB_EVENT_NAME': 'workflow_dispatch',
    'GITHUB_REF': 'refs/heads/main',
    'GITHUB_RUN_ATTEMPT': '1',
    'OPENAI_API_KEY': 'mock-credential',
}


def response(answer=None):
    if answer is None:
        answer = {'indices': [0, 1, 2], 'summary_order': [0, 1]}
    return json.dumps({'status': 'completed', 'output': [{'type': 'message', 'role': 'assistant',
        'content': [{'type': 'output_text', 'text': json.dumps(answer)}]}]}).encode()


class ApiSmokeTest(unittest.TestCase):
    def test_public_sample_and_structured_request(self):
        send = Mock(return_value=response())
        self.assertEqual(api_smoke.run(ENABLED, send=send),
                         (0, 'passed: one structured editorial response verified'))
        send.assert_called_once()
        wire, credential = send.call_args.args
        self.assertEqual(credential, 'mock-credential')
        request = json.loads(wire)
        self.assertEqual(request['model'], api_smoke.MODEL)
        self.assertEqual(request['tools'], [])
        self.assertEqual(request['reasoning'], {'effort': 'low'})
        self.assertFalse(request['store'])
        self.assertEqual(request['max_output_tokens'], 512)
        self.assertTrue(request['text']['format']['strict'])
        sample = json.loads(request['input'])
        self.assertEqual(sample['organizer_rules'], api_smoke.OFFICIAL)
        self.assertEqual(set(sample['titles']), {'ja', 'en'})
        self.assertEqual(sample['facts'][1]['value'], '2026-12-25T14:59:00Z')
        self.assertEqual(sample['facts'][2]['value']['amount'], 100_000)
        self.assertNotIn('mock-credential', request['input'])
        self.assertNotIn('korezo', request['input'])

    def test_gate_conditions_stop_before_reading_sample_or_sending(self):
        cases = [
            ('FREEBIE_TRAIL_API_SMOKE_ENABLED', '', 0, 'disabled'),
            ('FREEBIE_TRAIL_API_SMOKE_CONFIRMED', 'false', 0, 'confirmation missing'),
            ('GITHUB_EVENT_NAME', 'push', 0, 'first manual attempt'),
            ('GITHUB_REF', 'refs/tags/main', 0, 'first manual attempt'),
            ('GITHUB_REF', 'refs/heads/other', 0, 'first manual attempt'),
            ('GITHUB_RUN_ATTEMPT', '2', 0, 'first manual attempt'),
            ('FREEBIE_TRAIL_API_SMOKE_SLOT', '', 1, 'daily request limit'),
            ('FREEBIE_TRAIL_API_SMOKE_JST_DAY', '2020-01-01', 1, 'request slot expired'),
            ('OPENAI_API_KEY', '', 0, 'secret missing'),
        ]
        for name, value, expected, detail in cases:
            with self.subTest(name=name, value=value):
                sample, send = Mock(), Mock()
                code, message = api_smoke.run({**ENABLED, name: value}, send=send, sample=sample)
                self.assertEqual(code, expected)
                self.assertIn(detail, message)
                send.assert_not_called()
                sample.assert_not_called()

    def test_same_day_second_run_and_ambiguous_history_are_blocked(self):
        now = stamp('2026-11-25T15:03:00Z')  # 26 November, JST
        first = {'id': 10, 'created_at': '2026-11-25T15:01:00Z',
                 'head_branch': 'main', 'event': 'workflow_dispatch'}
        later = {**first, 'id': 11, 'created_at': '2026-11-25T15:02:00Z'}
        data = {'total_count': 2, 'workflow_runs': [later, first]}
        self.assertTrue(api_smoke.daily_slot(data, '10', now))
        self.assertFalse(api_smoke.daily_slot(data, '11', now))
        self.assertFalse(api_smoke.daily_slot({**data, 'total_count': 101}, '10', now))
        self.assertFalse(api_smoke.daily_slot(data, '10', stamp('2026-11-26T15:00:00Z')))

    def test_oversized_input_and_output_stop(self):
        send = Mock()
        sample = lambda: (b'a' * (api_smoke.MAX_INPUT_BYTES + 1), 3)
        self.assertEqual(api_smoke.run(ENABLED, send=send, sample=sample),
                         (1, 'stopped: request-size-limit'))
        send.assert_not_called()
        send.return_value = b'x' * (api_smoke.MAX_RESPONSE_BYTES + 1)
        self.assertEqual(api_smoke.run(ENABLED, send=send), (1, 'stopped: response-size-limit'))
        send.assert_called_once()

    def test_exact_mock_https_transport_and_no_retry_on_rate_limit_or_redirect(self):
        for status, diagnostic in ((429, 'rate-or-quota-limit'), (302, 'http-status'),
                                   (402, 'http-status'), (200, 'success')):
            with self.subTest(status=status), patch.object(api_smoke, 'PinnedHTTPS') as https:
                connection = https.return_value
                reply = connection.getresponse.return_value
                reply.status = status
                reply.getheader.return_value = 'application/json; charset=utf-8'
                reply.read.return_value = response()
                code, message = api_smoke.run(ENABLED)
                self.assertEqual(code, 0 if status == 200 else 1)
                if status != 200:
                    self.assertEqual(message, 'stopped: ' + diagnostic)
                    reply.read.assert_not_called()
                else:
                    reply.read.assert_called_once_with(api_smoke.MAX_RESPONSE_BYTES + 1)
                https.assert_called_once()
                self.assertEqual(https.call_args.args, ('api.openai.com',))
                connection.request.assert_called_once()
                self.assertEqual(connection.request.call_args.args[:2], ('POST', '/v1/responses'))
                self.assertEqual(connection.request.call_args.kwargs['headers']['Authorization'],
                                 'Bearer mock-credential')
                connection.close.assert_called_once()

    def test_refusal_bad_json_or_unknown_fact_never_appear_in_cli_output(self):
        bad = [
            b'private-response-body',
            response({'indices': [0, 9], 'summary_order': [9]}),
            response({'indices': [0], 'summary_order': [0], 'extra': 'private-response-body'}),
            b'{"status":"incomplete","output":[],"error":"private-response-body"}',
            b'{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"private-response-body"}]}]}',
            OSError('private-response-body mock-credential'),
        ]
        for payload in bad:
            with self.subTest(payload_type=type(payload)):
                send = Mock(side_effect=payload if isinstance(payload, OSError) else None,
                            return_value=payload)
                output = io.StringIO()
                with patch.object(api_smoke, 'run', side_effect=lambda env: original_run(env, send=send)), \
                     patch.object(api_smoke.os, 'environ', ENABLED), patch.object(api_smoke.sys, 'argv', ['api_smoke']), \
                     redirect_stdout(output):
                    self.assertEqual(api_smoke.main(), 1)
                self.assertRegex(output.getvalue(), r'^stopped: [a-z,-]+(?: [a-z,-]+)*\n$')
                self.assertNotIn('private-response-body', output.getvalue())
                self.assertNotIn('mock-credential', output.getvalue())
                send.assert_called_once()

    def test_workflow_has_only_manual_entry_and_no_publisher(self):
        workflow = (ROOT / '.github/workflows/freebie-trail-api-smoke.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('default: false', workflow)
        self.assertIn('github.run_attempt == 1', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn('environment: freebie-trail-api', workflow)
        self.assertIn('FREEBIE_TRAIL_API_SMOKE_ENABLED', workflow)
        self.assertIn('INHERITED_KEY_PRESENT', workflow)
        for forbidden in ('schedule:', 'repository_dispatch:', 'upload-artifact', 'contents: write',
                          'deployments: write', 'wrangler', 'web_search'):
            self.assertNotIn(forbidden, workflow)
        self.assertEqual(workflow.count('run: python3 -m radar.api_smoke\n'), 1)


original_run = api_smoke.run
