"""Wrapper for top-level bulk_resume_parser module."""
from importlib import import_module
try:
    orig = import_module('bulk_resume_parser')
    parse_args = getattr(orig, 'parse_args')
    main = getattr(orig, 'main')
    parse_single_file = getattr(orig, 'parse_single_file')
except Exception:
    # Provide placeholders in case original module isn't available
    def parse_args():
        raise RuntimeError('bulk_resume_parser not available')

    def main():
        raise RuntimeError('bulk_resume_parser not available')
