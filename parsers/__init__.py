"""Parsers package for the AI Sourcing Agent.

Re-exports parser modules for cleaner imports.
"""

# Re-export from submodules
try:
    from .bulk_jd_parser import (
        parse_jd,
        process_directory,
        extract_text_from_file,
        LLMConfig as JDLLMConfig,
        OpenAIJDParser,
    )
except Exception:
    parse_jd = None
    process_directory = None
    extract_text_from_file = None
    JDLLMConfig = None
    OpenAIJDParser = None

try:
    from .bulk_resume_parser import (
        parse_args,
        main as resume_main,
        parse_single_file,
        ResumeRuleBasedParser,
    )
except Exception:
    parse_args = None
    resume_main = None
    parse_single_file = None
    ResumeRuleBasedParser = None

try:
    from .llm_jd_parser import LLMConfig
except Exception:
    LLMConfig = None

try:
    from .llm_resume_parser import LLMConfig as ResumeLLMConfig, OpenAIResumeParser
except Exception:
    ResumeLLMConfig = None
    OpenAIResumeParser = None

try:
    from .client_context_parser import ClientContextParser
except Exception:
    ClientContextParser = None

__all__ = [
    'parse_jd',
    'process_directory',
    'extract_text_from_file',
    'JDLLMConfig',
    'ClientContextParser',
    'OpenAIJDParser',
    'parse_args',
    'resume_main',
    'parse_single_file',
    'ResumeRuleBasedParser',
    'LLMConfig',
    'ResumeLLMConfig',
    'OpenAIResumeParser',
]
