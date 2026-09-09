"""Compatibility module retained for existing LiteLLM launch environments.

The ClawNex launcher registers one logger instance for synchronous and
asynchronous LiteLLM callback paths. This module intentionally performs no
registration so a proxy request is not recorded more than once.
"""
