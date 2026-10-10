"""Fixed reading-quiz progress, independent of the language model's counting."""
from collections.abc import Sequence
from typing import TypedDict


class ReadingMessage(TypedDict):
    role: str
    text: str


QUESTION_COUNT = 3
COMPLETION_TEXT = (
    "おつかれさまでした。みっつのしつもんにこたえました。\n"
    "これで、よみもののれんしゅうはおわりです。"
)


def user_turns(messages: Sequence[ReadingMessage]) -> int:
    # The first user turn starts the quiz; the next three contain its answers.
    return sum(message["role"] == "user" for message in messages)


def is_complete(messages: Sequence[ReadingMessage]) -> bool:
    assistants = sum(message["role"] == "assistant" for message in messages)
    return user_turns(messages) > QUESTION_COUNT and assistants >= QUESTION_COUNT + 2


def completion_reply(messages: Sequence[ReadingMessage]) -> str | None:
    return COMPLETION_TEXT if user_turns(messages) > QUESTION_COUNT else None


def turn_instruction(messages: Sequence[ReadingMessage]) -> str:
    question = user_turns(messages)
    if not question:
        return ""
    return (
        f"\nREADING STATE: The application requires question {question} of {QUESTION_COUNT} now. "
        "Briefly react to the preceding answer if there is one, then ask only this one question. "
        "The application will close the reading after the third answer. Do not add extra questions."
    )
