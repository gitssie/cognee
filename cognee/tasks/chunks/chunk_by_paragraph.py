from typing import Any, Dict, Iterator
from uuid import NAMESPACE_OID, uuid5

from .chunk_by_sentence import chunk_by_sentence, get_word_size


def _iterate_sentence_parts(
    sentence: str,
    sentence_size: int,
    end_type: str | None,
    max_chunk_size: int,
    max_text_length: int | None,
):
    sentence_text_size = (
        len(sentence.encode("utf-8")) if max_text_length is not None else len(sentence)
    )

    # Always enforce the byte ceiling first. Even when token estimation says the
    # sentence is oversized, we still need to split it if the encoded text would
    # exceed Muninn's content limit.
    if max_text_length is None or sentence_text_size <= max_text_length:
        yield sentence, sentence_size, end_type
        return

    remaining_sentence = sentence
    while len(remaining_sentence) > max_text_length:
        sentence_part = remaining_sentence[:max_text_length]
        yield sentence_part, get_word_size(sentence_part), "sentence_cut"
        remaining_sentence = remaining_sentence[max_text_length:]

    if remaining_sentence:
        yield remaining_sentence, get_word_size(remaining_sentence), end_type


def _split_text_by_length(text: str, max_text_length: int) -> Iterator[str]:
    start = 0
    while start < len(text):
        yield text[start : start + max_text_length]
        start += max_text_length


def _split_text_by_utf8_length(text: str, max_text_length: int) -> Iterator[str]:
    current_chars: list[str] = []
    current_size = 0

    for char in text:
        char_size = len(char.encode("utf-8"))
        if current_chars and current_size + char_size > max_text_length:
            yield "".join(current_chars)
            current_chars = []
            current_size = 0

        if char_size > max_text_length:
            raise ValueError("Single character exceeds max_text_length in UTF-8 bytes")

        current_chars.append(char)
        current_size += char_size

    if current_chars:
        yield "".join(current_chars)


def chunk_by_paragraph(
    data: str,
    max_chunk_size,
    max_text_length: int | None = None,
    batch_paragraphs: bool = True,
) -> Iterator[Dict[str, Any]]:
    """
    Chunk the input text by paragraph while enabling exact text reconstruction.

    This function divides the given text data into smaller chunks based on the specified
    maximum chunk size. It ensures that when the generated chunks are concatenated, they
    reproduce the original text accurately. The tokenization process is handled by adapters
    compatible with the vector engine's embedding model, and the function can operate in
    either batch mode or paragraph mode, based on the `batch_paragraphs` flag.

    Parameters:
    -----------

        - data (str): The input text to be chunked.
        - max_chunk_size: The maximum allowed size for each chunk, in terms of tokens or
          words.
        - batch_paragraphs (bool): Flag indicating whether to yield each paragraph as a
          separate chunk. If set to False, individual paragraphs are yielded as they are
          processed. (default True)
    """
    current_chunk = ""
    chunk_index = 0
    paragraph_ids = []
    last_cut_type = "default"
    current_chunk_size = 0
    current_text_length = 0

    def get_text_size(text: str) -> int:
        if max_text_length is None:
            return len(text)
        return len(text.encode("utf-8"))

    if (
        max_text_length is not None
        and len(data.encode("utf-8")) > max_text_length
        and "\n" not in data
        and " " not in data
    ):
        for text_part in _split_text_by_utf8_length(data, max_text_length):
            yield {
                "text": text_part,
                "chunk_size": get_word_size(text_part),
                "chunk_id": uuid5(NAMESPACE_OID, text_part),
                "paragraph_ids": [uuid5(NAMESPACE_OID, f"{chunk_index}")],
                "chunk_index": chunk_index,
                "cut_type": "sentence_cut",
            }
            chunk_index += 1
        return

    for paragraph_id, sentence, sentence_size, end_type in chunk_by_sentence(
        data, maximum_size=max_chunk_size
    ):
        for sentence_part, sentence_part_size, sentence_part_end_type in _iterate_sentence_parts(
            sentence,
            sentence_size,
            end_type,
            max_chunk_size,
            max_text_length,
        ):
            exceeds_token_limit = current_chunk_size + sentence_part_size > max_chunk_size
            exceeds_text_limit = max_text_length is not None and (
                current_text_length + get_text_size(sentence_part) > max_text_length
            )

            if current_chunk_size > 0 and (exceeds_token_limit or exceeds_text_limit):
                chunk_dict = {
                    "text": current_chunk,
                    "chunk_size": current_chunk_size,
                    "chunk_id": uuid5(NAMESPACE_OID, current_chunk),
                    "paragraph_ids": paragraph_ids,
                    "chunk_index": chunk_index,
                    "cut_type": last_cut_type,
                }

                yield chunk_dict

                paragraph_ids = []
                current_chunk = ""
                current_chunk_size = 0
                current_text_length = 0
                chunk_index += 1

            paragraph_ids.append(paragraph_id)
            current_chunk += sentence_part
            current_chunk_size += sentence_part_size
            current_text_length += get_text_size(sentence_part)

            if sentence_part_end_type in ("paragraph_end", "sentence_cut") and not batch_paragraphs:
                chunk_dict = {
                    "text": current_chunk,
                    "chunk_size": current_chunk_size,
                    "paragraph_ids": paragraph_ids,
                    "chunk_id": uuid5(NAMESPACE_OID, current_chunk),
                    "chunk_index": chunk_index,
                    "cut_type": sentence_part_end_type,
                }
                yield chunk_dict
                paragraph_ids = []
                current_chunk = ""
                current_chunk_size = 0
                current_text_length = 0
                chunk_index += 1

            if not sentence_part_end_type:
                sentence_part_end_type = "default"

            last_cut_type = sentence_part_end_type

    # Yield any remaining text
    if current_chunk:
        chunk_dict = {
            "text": current_chunk,
            "chunk_size": current_chunk_size,
            "chunk_id": uuid5(NAMESPACE_OID, current_chunk),
            "paragraph_ids": paragraph_ids,
            "chunk_index": chunk_index,
            "cut_type": "sentence_cut" if last_cut_type == "word" else last_cut_type,
        }

        yield chunk_dict
