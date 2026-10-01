"""Failure contracts written before the Codex adapter implementation."""
import json
import unittest
from unittest.mock import patch

from server import codex_policy, codex_provider


class CodexFailureContracts(unittest.TestCase):
    def test_missing_cli_reports_actionable_status(self):
        with patch('server.codex_provider.shutil.which', return_value=None):
            result = codex_provider.status()
        self.assertFalse(result['ready'])
        self.assertFalse(result['installed'])
        self.assertIn('Codex', result['message'])

    def test_api_key_login_does_not_claim_subscription_ready(self):
        with patch('server.codex_provider.shutil.which', return_value='/fake/codex'), \
             patch('server.codex_provider.subprocess.run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = ''
            run.return_value.stderr = 'Logged in using an API key'
            result = codex_provider.status()
        self.assertFalse(result['ready'])
        self.assertFalse(result['logged_in'])

    def test_inherited_integrations_are_disabled_without_copying_secrets(self):
        inherited = {"mcp_servers": {"private": {"token": "secret"}},
                     "plugins": {"custom": {"enabled": True}},
                     "apps": {"mail": {"enabled": True}}}
        config = codex_policy.tutor_config(inherited)
        self.assertEqual(config["mcp_servers"]["private"], {"enabled": False})
        self.assertFalse(config["plugins"]["custom"]["enabled"])
        self.assertFalse(config["apps"]["mail"]["enabled"])
        self.assertNotIn("secret", json.dumps(config))

    def test_json_failures_are_explicit_and_not_empty_success(self):
        for text in ('bad json', '[]', 'null', 'true'):
            with self.subTest(text=text), self.assertRaises(codex_provider.CodexError):
                codex_provider.parse_json_object(text)

    def test_weaker_sandbox_is_rejected_before_inference(self):
        with self.assertRaises(codex_provider.CodexError):
            codex_provider.validate_sandbox({'sandbox': {'type': 'dangerFullAccess'}})

    def test_account_status_does_not_disclose_cli_output(self):
        with patch('server.codex_provider.shutil.which', return_value='/fake/codex'), \
             patch('server.codex_provider.subprocess.run') as run:
            run.return_value.returncode = 1
            run.return_value.stdout = 'secret'
            run.return_value.stderr = 'sensitive path'
            result = codex_provider.status()
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn('sensitive path', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
