supported_databases = {}

try:
    from .muninn import MuninnAdapter

    supported_databases["muninn"] = MuninnAdapter
except ImportError:
    pass

from .use_vector_adapter import use_vector_adapter

__all__ = ["supported_databases", "use_vector_adapter"]
