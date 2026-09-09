import { parse, type ParseError } from 'jsonc-parser';

export function parseOpenCodeConfig(source: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('OpenCode global configuration is not valid JSONC.');
  }
  return value as Record<string, unknown>;
}
