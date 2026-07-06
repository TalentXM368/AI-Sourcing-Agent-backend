"""Wrapper for top-level llm_resume_parser module."""
from importlib import import_module
try:
    orig = import_module('llm_resume_parser')
    LLMConfig = getattr(orig, 'LLMConfig')
    OpenAIResumeParser = getattr(orig, 'OpenAIResumeParser')
except Exception:
    LLMConfig = None
    OpenAIResumeParser = None
