"""Restrict inherited Codex capabilities to the language tutor boundary."""


def tutor_config(inherited: dict) -> dict:
    # Replace inherited integration maps as well as feature toggles. This process
    # serves a language tutor and must not expose the user's tools or repositories.
    disabled = ('shell_tool', 'unified_exec', 'apply_patch_freeform', 'apps',
                'plugins', 'browser_use', 'computer_use', 'image_generation',
                'view_image', 'multi_agent', 'js_repl', 'code_mode',
                'memory_tool', 'goals', 'request_permissions', 'tool_search',
                'skill_search', 'hooks', 'codex_hooks', 'plugin_hooks')
    return {'features': {name: False for name in disabled},
            'web_search': 'disabled',
            'mcp_servers': {name: {'enabled': False} for name in (inherited.get('mcp_servers') or {})},
            'plugins': {name: {'enabled': False} for name in (inherited.get('plugins') or {})},
            'apps': {name: {'enabled': False} for name in
                     {'_default', *(inherited.get('apps') or {})}},
            'tools': {'update_plan': {'enabled': False},
                      'experimental_request_user_input': {'enabled': False}},
            'project_doc_max_bytes': 0, 'include_apps_instructions': False}

