from dataclasses import dataclass
from typing import Callable, Any


@dataclass
class PrinterField:
    name: str
    header_format: str
    value_format: str
    footer_format: str | None = None
    width: int = 0
    empty_char: str = '-'
    footer_transformer: Callable[[Any], str] | None = None
    value_transformer: Callable[[Any], str] | None = None

    @property
    def empty_value(self):
        return self.empty_char * self.width

    def formatted_value(self, value: Any | None = None) -> str:
        if value is None:
            return f"{self.empty_value:{self.width}s}"

        if self.value_transformer is not None:
            value = self.value_transformer(value)

        value = f'{value:{self.value_format}}'

        if len(_val := str(value)) > self.width:
            value = _val[:self.width - 3] + '...'

        return value

    def formatted_header(self, override: str | None = None):
        return f'{self.name if override is None else override:{self.header_format}}'
