# src/cartofia_bot/logging_utils.py
from __future__ import annotations

import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    """
    Configure root logger with a simple, readable format.
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )

    # Optional: be quieter for noisy libraries if needed later
    logging.getLogger("discord").setLevel(logging.INFO)
