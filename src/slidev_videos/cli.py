"""Console entry point: `slidev-videos <subcommand>`."""
import sys


def main() -> None:
    from . import pipeline
    sys.exit(pipeline.main())
