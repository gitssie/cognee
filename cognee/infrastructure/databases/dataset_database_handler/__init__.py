from .dataset_database_handler_interface import DatasetDatabaseHandlerInterface

__all__ = [
    "DatasetDatabaseHandlerInterface",
    "supported_dataset_database_handlers",
    "use_dataset_database_handler",
]


def __getattr__(name: str):
    if name == "supported_dataset_database_handlers":
        from .supported_dataset_database_handlers import supported_dataset_database_handlers

        return supported_dataset_database_handlers

    if name == "use_dataset_database_handler":
        from .use_dataset_database_handler import use_dataset_database_handler

        return use_dataset_database_handler

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
