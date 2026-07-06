"""Wrapper for top-level llm_jd_parser module."""
from importlib import import_module
try:
    orig = import_module('llm_jd_parser')
    LLMConfig = getattr(orig, 'LLMConfig')
    OpenAIJDParser = getattr(orig, 'OpenAIJDParser')
except Exception:
    LLMConfig = None
    OpenAIJDParser = None
