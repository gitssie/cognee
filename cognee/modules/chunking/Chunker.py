from typing import Any


class Chunker:
    def __init__(self, document, get_text: Any, max_chunk_size: int):
        self.chunk_index = 0
        self.chunk_size = 0
        self.token_count = 0

        self.document = document
        self.max_chunk_size = max_chunk_size
        self.get_text = get_text
        self.max_text_length = None

    def read(self):
        raise NotImplementedError
